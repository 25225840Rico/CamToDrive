(function () {
  "use strict";

  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
  const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
  const DB_NAME = "camtodrive-db";
  const DB_VERSION = 1;
  const STORE_NAME = "pendingPhotos";
  const TOKEN_SAFETY_MS = 30 * 1000;
  const UPLOAD_CONCURRENCY = 3;
  const MAX_UPLOAD_ATTEMPTS = 3;
  const RETRY_BASE_DELAY_MS = 1200;

  const elements = {};
  const state = {
    accessToken: null,
    tokenClient: null,
    tokenExpiresAt: 0,
    tokenExpiryTimer: null,
    gisReady: false,
    isProcessingQueue: false,
    queueProcessRequested: false,
    pendingCount: 0,
    uploadingCount: 0,
    authHintMessage: "",
    cameraStream: null,
    cameraStartPromise: null,
    imageCapture: null,
    cameraReady: false,
    cameraError: "",
    captureInProgress: false,
    lastThumbUrl: null,
    recentPhotos: [],
  };

  let dbPromise = null;

  class AuthExpiredError extends Error {
    constructor(message) {
      super(message || "La sesion de Google expiro.");
      this.name = "AuthExpiredError";
    }
  }

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindEvents();
    renderRecentPhotos();
    updateNetworkStatus();
    registerServiceWorker();

    await refreshPendingCount();
    updateControls();
    startCamera();

    if (!hasConfiguredClientId()) {
      setStatus("Conectar Google", "warning");
      setHint("Reemplaza el CLIENT_ID en config.js antes de conectar Google.");
      return;
    }

    try {
      await waitForGoogleIdentity();
      state.tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: getAppConfig().CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: handleTokenResponse,
      });
      state.gisReady = true;
      setStatus(state.cameraReady ? "Camara lista" : "Preparando camara");
      clearHint();
    } catch (error) {
      console.error(error);
      setStatus("No se pudo cargar Google", "error");
      setHint("Revisa la conexion y recarga la app.");
    }

    updateControls();
  }

  function cacheElements() {
    elements.connectButton = document.getElementById("connectButton");
    elements.captureButton = document.getElementById("captureButton");
    elements.cameraInput = document.getElementById("cameraInput");
    elements.fallbackCaptureButton = document.getElementById("fallbackCaptureButton");
    elements.retryCameraButton = document.getElementById("retryCameraButton");
    elements.cameraVideo = document.getElementById("cameraVideo");
    elements.cameraMessage = document.getElementById("cameraMessage");
    elements.statusText = document.getElementById("statusText");
    elements.pendingCount = document.getElementById("pendingCount");
    elements.uploadingCount = document.getElementById("uploadingCount");
    elements.networkStatus = document.getElementById("networkStatus");
    elements.lastThumb = document.getElementById("lastThumb");
    elements.emptyThumb = document.getElementById("emptyThumb");
    elements.authHint = document.getElementById("authHint");
    elements.recentList = document.getElementById("recentList");
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", requestGoogleToken);
    elements.captureButton.addEventListener("click", capturePhoto);
    elements.fallbackCaptureButton.addEventListener("click", () => elements.cameraInput.click());
    elements.retryCameraButton.addEventListener("click", () => startCamera({ force: true }));
    elements.cameraInput.addEventListener("change", handleNativeCapture);

    window.addEventListener("online", () => {
      updateNetworkStatus();
      if (isAuthenticated()) {
        processPendingQueue();
      }
    });

    window.addEventListener("offline", () => {
      updateNetworkStatus();
      setQueuedStatus();
      setHint("Sin conexion: las fotos quedan guardadas y se subiran despues.");
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        stopCamera();
        return;
      }

      startCamera();
      if (isAuthenticated()) {
        processPendingQueue();
      }
    });

    window.addEventListener("pagehide", stopCamera);
  }

  function getAppConfig() {
    if (typeof CONFIG !== "undefined") {
      return CONFIG;
    }
    return window.CAMTODRIVE_CONFIG || {};
  }

  function hasConfiguredClientId() {
    const clientId = getAppConfig().CLIENT_ID || "";
    return clientId.endsWith(".apps.googleusercontent.com") && !clientId.startsWith("TODO_");
  }

  function waitForGoogleIdentity() {
    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        if (window.google && google.accounts && google.accounts.oauth2) {
          window.clearInterval(timer);
          resolve();
          return;
        }

        if (Date.now() - startedAt > 12000) {
          window.clearInterval(timer);
          reject(new Error("Google Identity Services no cargo a tiempo."));
        }
      }, 100);
    });
  }

  function requestGoogleToken() {
    if (!state.tokenClient || !hasConfiguredClientId()) {
      return;
    }

    setStatus("Conectar Google");
    setHint("Esperando autorizacion de Google...");
    state.tokenClient.callback = handleTokenResponse;
    state.tokenClient.requestAccessToken({ prompt: state.accessToken ? "" : "consent" });
  }

  async function handleTokenResponse(response) {
    if (!response || response.error) {
      console.error("Error OAuth", response);
      clearAuth(false);
      setStatus("Conectar Google", "error");
      setHint("No se completo la conexion con Google.");
      updateControls();
      return;
    }

    const expiresInMs = Math.max(0, Number(response.expires_in || 3600) * 1000 - TOKEN_SAFETY_MS);
    state.accessToken = response.access_token;
    state.tokenExpiresAt = Date.now() + expiresInMs;
    scheduleTokenExpiry(expiresInMs);

    setStatus(state.pendingCount > 0 ? "Subiendo cola..." : "Camara lista", "ok");
    setHint("Conectado a Google Drive con el scope Drive completo.");
    updateControls();
    await processPendingQueue();
  }

  function scheduleTokenExpiry(expiresInMs) {
    if (state.tokenExpiryTimer) {
      window.clearTimeout(state.tokenExpiryTimer);
    }

    state.tokenExpiryTimer = window.setTimeout(() => {
      clearAuth(false);
      if (state.pendingCount > 0) {
        setQueuedStatus();
        setHint("Reconecta Google para continuar con los pendientes.");
      } else {
        setStatus("Conectar Google", "warning");
        setHint("La sesion expiro. Conecta Google otra vez.");
      }
      updateControls();
    }, Math.max(1000, expiresInMs));
  }

  function clearAuth(shouldUpdateControls = true) {
    state.accessToken = null;
    state.tokenExpiresAt = 0;
    if (state.tokenExpiryTimer) {
      window.clearTimeout(state.tokenExpiryTimer);
      state.tokenExpiryTimer = null;
    }
    if (shouldUpdateControls) {
      updateControls();
    }
  }

  function isAuthenticated() {
    return Boolean(state.accessToken && Date.now() < state.tokenExpiresAt);
  }

  async function startCamera(options = {}) {
    const force = Boolean(options.force);
    if (state.cameraStartPromise) {
      return state.cameraStartPromise;
    }
    if (state.cameraReady && !force) {
      return Promise.resolve();
    }
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      showCameraError("Este navegador no permite camara en pagina. Usa el selector nativo.");
      return Promise.resolve();
    }

    state.cameraStartPromise = doStartCamera(force).finally(() => {
      state.cameraStartPromise = null;
      updateControls();
    });
    updateControls();
    return state.cameraStartPromise;
  }

  async function doStartCamera(force) {
    if (force) {
      stopCamera();
    }

    const hadCameraError = Boolean(state.cameraError);
    state.cameraError = "";
    state.cameraReady = false;
    state.imageCapture = null;
    setCameraMessage("Iniciando camara...");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 4096 },
          height: { ideal: 2160 },
        },
      });

      stopCamera();
      state.cameraStream = stream;
      const track = stream.getVideoTracks()[0];
      if (track) {
        track.addEventListener("ended", handleCameraEnded);
        await maximizeTrackResolution(track);
        if (typeof ImageCapture === "function") {
          try {
            state.imageCapture = new ImageCapture(track);
          } catch (error) {
            console.warn("ImageCapture no disponible para este track", error);
          }
        }
      }

      elements.cameraVideo.srcObject = stream;
      await elements.cameraVideo.play();
      state.cameraReady = true;
      state.cameraError = "";
      if (hadCameraError) {
        clearHint();
      }
      setCameraMessage(getCameraSettingsText());
      if (!state.isProcessingQueue) {
        setStatus("Camara lista", "ok");
      }
    } catch (error) {
      console.error(error);
      stopCamera();
      showCameraError(getCameraErrorMessage(error));
    }
  }

  async function maximizeTrackResolution(track) {
    if (!track || typeof track.getCapabilities !== "function" || typeof track.applyConstraints !== "function") {
      return;
    }

    const capabilities = track.getCapabilities();
    const videoConstraints = {};
    const advanced = [];

    if (capabilities.width && capabilities.width.max) {
      videoConstraints.width = { ideal: capabilities.width.max };
      advanced.push({ width: capabilities.width.max });
    }
    if (capabilities.height && capabilities.height.max) {
      videoConstraints.height = { ideal: capabilities.height.max };
      advanced.push({ height: capabilities.height.max });
    }

    if (Object.keys(videoConstraints).length === 0) {
      return;
    }

    try {
      await track.applyConstraints({
        ...videoConstraints,
        advanced,
      });
    } catch (error) {
      console.warn("No se pudo aplicar la resolucion maxima; se usa la otorgada.", error);
    }
  }

  function stopCamera() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach((track) => track.stop());
    }
    state.cameraStream = null;
    state.imageCapture = null;
    state.cameraReady = false;
    if (elements.cameraVideo) {
      elements.cameraVideo.srcObject = null;
    }
  }

  function handleCameraEnded() {
    state.cameraReady = false;
    state.imageCapture = null;
    showCameraError("La camara se cerro. Puedes reintentar sin perder la cola.");
  }

  function showCameraError(message) {
    state.cameraError = message;
    state.cameraReady = false;
    state.imageCapture = null;
    setStatus("Camara no disponible", "warning");
    setCameraMessage(message);
    setHint(message);
    updateControls();
  }

  function getCameraErrorMessage(error) {
    if (error && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError")) {
      return "Permiso de camara denegado. Habilitalo en el navegador y pulsa Reintentar.";
    }
    if (location.protocol !== "https:" && location.hostname !== "localhost") {
      return "La camara en pagina requiere HTTPS. En GitHub Pages funciona con HTTPS.";
    }
    return "No se pudo abrir la camara. Puedes reintentar o usar el selector nativo.";
  }

  function setCameraMessage(message) {
    elements.cameraMessage.textContent = message;
  }

  function getCameraSettingsText() {
    const track = state.cameraStream && state.cameraStream.getVideoTracks()[0];
    if (!track || typeof track.getSettings !== "function") {
      return "Camara continua activa";
    }

    const settings = track.getSettings();
    if (settings.width && settings.height) {
      return `Camara continua activa (${settings.width} x ${settings.height})`;
    }
    return "Camara continua activa";
  }

  async function capturePhoto() {
    if (!state.cameraReady || state.captureInProgress) {
      return;
    }

    state.captureInProgress = true;
    updateControls();

    try {
      const blob = await takePhotoBlob();
      const fileName = makePhotoFileName(new Date());
      await storeCapturedPhoto(blob, fileName, "Camara");
    } catch (error) {
      console.error(error);
      setStatus("No se pudo capturar", "error");
      setHint("Reintenta la foto. La cola existente no se modifico.");
    } finally {
      state.captureInProgress = false;
      updateControls();
    }
  }

  async function takePhotoBlob() {
    if (state.imageCapture && typeof state.imageCapture.takePhoto === "function") {
      try {
        return await state.imageCapture.takePhoto();
      } catch (error) {
        console.warn("ImageCapture.takePhoto fallo; se usara canvas.", error);
      }
    }

    return captureVideoFrameAsJpeg();
  }

  async function captureVideoFrameAsJpeg() {
    const video = elements.cameraVideo;
    await waitForVideoFrame(video);

    const track = state.cameraStream && state.cameraStream.getVideoTracks()[0];
    const settings = track && typeof track.getSettings === "function" ? track.getSettings() : {};
    const width = settings.width || video.videoWidth;
    const height = settings.height || video.videoHeight;

    if (!width || !height) {
      throw new Error("El video aun no entrega dimensiones.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, width, height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("No se pudo exportar la foto JPEG."));
      }, "image/jpeg", 0.95);
    });
  }

  function waitForVideoFrame(video) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth && video.videoHeight) {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        cleanup();
        reject(new Error("La camara no entrego imagen a tiempo."));
      }, 5000);
      const onLoaded = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        window.clearTimeout(timer);
        video.removeEventListener("loadeddata", onLoaded);
      };
      video.addEventListener("loadeddata", onLoaded, { once: true });
    });
  }

  async function handleNativeCapture(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    const fileName = makePhotoFileName(new Date());
    await storeCapturedPhoto(file, fileName, "Selector nativo");
  }

  async function storeCapturedPhoto(blob, fileName, sourceLabel) {
    showThumbnail(blob);
    const pendingId = await enqueuePhoto(blob, fileName);
    addRecentPhoto({
      id: pendingId,
      fileName,
      status: "queued",
      label: sourceLabel,
    });
    setQueuedStatus();
    setHint(isAuthenticated()
      ? "Foto en cola; la subida sigue en segundo plano."
      : "Foto guardada. Conecta Google para subir los pendientes.");
    updateControls();

    if (isAuthenticated()) {
      processPendingQueue();
    }
  }

  function showThumbnail(blob) {
    if (state.lastThumbUrl) {
      URL.revokeObjectURL(state.lastThumbUrl);
    }

    state.lastThumbUrl = URL.createObjectURL(blob);
    elements.lastThumb.src = state.lastThumbUrl;
    elements.lastThumb.hidden = false;
    elements.emptyThumb.hidden = true;
  }

  function addRecentPhoto(photo) {
    state.recentPhotos.unshift(photo);
    state.recentPhotos = state.recentPhotos.slice(0, 6);
    renderRecentPhotos();
  }

  function updateRecentPhoto(id, status) {
    const photo = state.recentPhotos.find((item) => item.id === id);
    if (photo) {
      photo.status = status;
      renderRecentPhotos();
    }
  }

  function renderRecentPhotos() {
    if (!elements.recentList) {
      return;
    }

    elements.recentList.replaceChildren();
    if (state.recentPhotos.length === 0) {
      const item = document.createElement("li");
      item.className = "recent-empty";
      item.textContent = "Sin disparos recientes";
      elements.recentList.appendChild(item);
      return;
    }

    state.recentPhotos.forEach((photo) => {
      const item = document.createElement("li");
      item.className = `recent-item ${photo.status}`;

      const name = document.createElement("span");
      name.className = "recent-name";
      name.textContent = photo.fileName;

      const badge = document.createElement("span");
      badge.className = "recent-badge";
      badge.textContent = getRecentStatusText(photo.status);

      item.append(name, badge);
      elements.recentList.appendChild(item);
    });
  }

  function getRecentStatusText(status) {
    if (status === "uploading") {
      return "Subiendo";
    }
    if (status === "done") {
      return "OK";
    }
    if (status === "error") {
      return "Pendiente";
    }
    return "En cola";
  }

  async function uploadPhotoToDrive(blob, fileName) {
    let folderId = await getOrCreateFolderId();
    let response = await sendMultipartUpload(folderId, blob, fileName);

    if (response.status === 404) {
      localStorage.removeItem(getFolderStorageKey());
      folderId = await getOrCreateFolderId();
      response = await sendMultipartUpload(folderId, blob, fileName);
    }

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }

    return response.json();
  }

  async function sendMultipartUpload(folderId, blob, fileName) {
    const mimeType = blob.type || "image/jpeg";
    const metadata = {
      name: fileName,
      mimeType,
      parents: [folderId],
    };
    const boundary = makeBoundary();
    const body = new Blob(
      [
        `--${boundary}\r\n`,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        JSON.stringify(metadata),
        `\r\n--${boundary}\r\n`,
        `Content-Type: ${mimeType}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    return authorizedFetch(DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    });
  }

  async function getOrCreateFolderId() {
    // Si hay una carpeta fija configurada, se usa directo para todos los usuarios autorizados.
    const fixedFolderId = getAppConfig().FOLDER_ID;
    if (fixedFolderId) {
      return fixedFolderId;
    }

    const storageKey = getFolderStorageKey();
    const cachedFolderId = localStorage.getItem(storageKey);
    if (cachedFolderId) {
      return cachedFolderId;
    }

    const foundFolderId = await findDriveFolder();
    if (foundFolderId) {
      localStorage.setItem(storageKey, foundFolderId);
      return foundFolderId;
    }

    const createdFolderId = await createDriveFolder();
    localStorage.setItem(storageKey, createdFolderId);
    return createdFolderId;
  }

  async function findDriveFolder() {
    const folderName = getAppConfig().FOLDER_NAME || "Fotos App";
    const query = [
      "mimeType='application/vnd.google-apps.folder'",
      "trashed=false",
      `name='${escapeDriveQueryValue(folderName)}'`,
      "'root' in parents",
    ].join(" and ");
    const params = new URLSearchParams({
      q: query,
      spaces: "drive",
      fields: "files(id,name)",
      pageSize: "1",
    });
    const response = await authorizedFetch(`${DRIVE_FILES_URL}?${params.toString()}`);

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }

    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }

  async function createDriveFolder() {
    const folderName = getAppConfig().FOLDER_NAME || "Fotos App";
    const response = await authorizedFetch(`${DRIVE_FILES_URL}?fields=id,name`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
      }),
    });

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }

    const data = await response.json();
    return data.id;
  }

  async function authorizedFetch(url, options = {}) {
    if (!isAuthenticated()) {
      throw new AuthExpiredError();
    }

    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${state.accessToken}`);

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      clearAuth(false);
      throw new AuthExpiredError("Google solicita reconectar la cuenta.");
    }

    return response;
  }

  async function getResponseMessage(response) {
    const fallback = `Google Drive respondio con HTTP ${response.status}.`;
    try {
      const data = await response.clone().json();
      return data.error && data.error.message ? data.error.message : fallback;
    } catch (_error) {
      try {
        return (await response.text()) || fallback;
      } catch (_textError) {
        return fallback;
      }
    }
  }

  async function enqueuePhoto(blob, fileName) {
    const id = await addPendingPhoto(blob, fileName);
    await refreshPendingCount();
    return id;
  }

  async function processPendingQueue() {
    if (state.isProcessingQueue) {
      state.queueProcessRequested = true;
      await refreshPendingCount();
      return;
    }
    if (!navigator.onLine || !isAuthenticated()) {
      await refreshPendingCount();
      updateControls();
      return;
    }

    state.isProcessingQueue = true;
    state.queueProcessRequested = false;
    setStatus("Subiendo cola...");
    updateControls();

    let uploadedCount = 0;
    let failedCount = 0;
    let authFailed = false;

    try {
      const pendingPhotos = await getPendingPhotos();
      const queue = pendingPhotos.slice();
      if (queue.length === 0) {
        setStatus("Camara lista", "ok");
        return;
      }
      const workerCount = Math.min(UPLOAD_CONCURRENCY, queue.length);

      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !authFailed && navigator.onLine) {
          const photo = queue.shift();
          updateRecentPhoto(photo.id, "uploading");
          state.uploadingCount += 1;
          updateControls();

          try {
            await uploadWithRetries(photo);
            await deletePendingPhoto(photo.id);
            uploadedCount += 1;
            updateRecentPhoto(photo.id, "done");
            await refreshPendingCount();
          } catch (error) {
            console.error(error);
            if (error instanceof AuthExpiredError) {
              authFailed = true;
              clearAuth(false);
            } else {
              failedCount += 1;
              updateRecentPhoto(photo.id, "error");
            }
          } finally {
            state.uploadingCount = Math.max(0, state.uploadingCount - 1);
            updateControls();
          }
        }
      });

      await Promise.all(workers);

      if (authFailed) {
        setQueuedStatus();
        setHint("Reconecta Google para subir pendientes.");
      } else if (!navigator.onLine) {
        setQueuedStatus();
        setHint("Sin conexion: se reintentara automaticamente.");
      } else if (failedCount > 0) {
        setQueuedStatus();
        setHint("Hay pendientes; se reintentara con backoff cuando haya conexion.");
      } else if (uploadedCount > 0) {
        setStatus("Fotos subidas", "ok");
        setHint("Las fotos pendientes quedaron guardadas en Google Drive.");
      }
    } finally {
      state.isProcessingQueue = false;
      await refreshPendingCount();
      updateControls();

      if (state.queueProcessRequested && navigator.onLine && isAuthenticated()) {
        state.queueProcessRequested = false;
        window.setTimeout(processPendingQueue, 0);
      }
    }
  }

  async function uploadWithRetries(photo) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        await uploadPhotoToDrive(photo.blob, photo.fileName);
        return;
      } catch (error) {
        if (error instanceof AuthExpiredError) {
          throw error;
        }
        lastError = error;
        if (!navigator.onLine) {
          break;
        }
        if (attempt < MAX_UPLOAD_ATTEMPTS) {
          await delay(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }
    throw lastError || new Error("No se pudo subir la foto.");
  }

  function delay(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function openDb() {
    if (dbPromise) {
      return dbPromise;
    }

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, {
            keyPath: "id",
            autoIncrement: true,
          });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  async function addPendingPhoto(blob, fileName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).add({
        blob,
        fileName,
        type: blob.type || "image/jpeg",
        createdAt: Date.now(),
      });

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getPendingPhotos() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => {
        const photos = request.result || [];
        photos.sort((a, b) => a.id - b.id);
        resolve(photos);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function deletePendingPhoto(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function refreshPendingCount() {
    const db = await openDb();
    state.pendingCount = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).count();
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
    updateControls();
  }

  function makePhotoFileName(date) {
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("-") + "_" + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
      pad(date.getMilliseconds(), 3),
    ].join("-") + ".jpg";
  }

  function makeBoundary() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
      return `camtodrive_${crypto.randomUUID().replaceAll("-", "")}`;
    }
    return `camtodrive_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  }

  function escapeDriveQueryValue(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  }

  function getFolderStorageKey() {
    return `camtodrive.folderId.${getAppConfig().FOLDER_NAME || "Fotos App"}`;
  }

  function setStatus(message, tone) {
    elements.statusText.textContent = message;
    elements.statusText.classList.remove("ok", "warning", "error");
    if (tone) {
      elements.statusText.classList.add(tone);
    }
  }

  function setQueuedStatus() {
    const count = state.pendingCount;
    if (count > 0 || state.uploadingCount > 0) {
      setStatus(`En cola (${count} ${count === 1 ? "pendiente" : "pendientes"})`, "warning");
    } else {
      setStatus("Camara lista", "ok");
    }
  }

  function setHint(message) {
    state.authHintMessage = message;
    updateControls();
  }

  function clearHint() {
    state.authHintMessage = "";
    updateControls();
  }

  function updateControls() {
    if (!elements.connectButton) {
      return;
    }

    const configured = hasConfiguredClientId();
    const authenticated = isAuthenticated();

    elements.connectButton.disabled = !configured || !state.gisReady;
    elements.connectButton.hidden = authenticated;
    elements.captureButton.disabled = !state.cameraReady || state.captureInProgress;
    elements.fallbackCaptureButton.hidden = !state.cameraError;
    elements.retryCameraButton.hidden = !state.cameraError;
    elements.pendingCount.textContent = String(state.pendingCount);
    elements.uploadingCount.textContent = String(state.uploadingCount);
    elements.authHint.textContent = state.authHintMessage || getDefaultHint(configured, authenticated);
  }

  function getDefaultHint(configured, authenticated) {
    if (!configured) {
      return "Reemplaza el CLIENT_ID en config.js antes de conectar Google.";
    }
    if (!state.gisReady) {
      return "Cargando Google Identity Services...";
    }
    if (!state.cameraReady && !state.cameraError) {
      return "Preparando camara...";
    }
    if (authenticated && state.pendingCount > 0) {
      return "Los pendientes se subiran automaticamente con conexion.";
    }
    if (authenticated) {
      return "Listo para tomar fotos y subirlas a Drive.";
    }
    if (state.pendingCount > 0) {
      return "Conecta Google para subir pendientes.";
    }
    return "Puedes tomar fotos ahora; conecta Google para subirlas.";
  }

  function updateNetworkStatus() {
    const online = navigator.onLine;
    elements.networkStatus.textContent = online ? "En linea" : "Sin conexion";
    elements.networkStatus.classList.toggle("online", online);
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    window.addEventListener("load", () => {
      navigator.serviceWorker.register("service-worker.js", { scope: "./" }).catch((error) => {
        console.warn("No se pudo registrar el service worker", error);
      });
    });
  }
})();

