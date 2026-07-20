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
    cameraError: "",
    captureInProgress: false,
    lastThumbUrl: null,
    recentPhotos: [],
    uploadProgressById: new Map(),
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

    setCameraMessage("Toca Disparar para abrir la camara nativa trasera.");
    await refreshPendingCount();
    updateControls();

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
      setStatus("Camara nativa lista", "ok");
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
    elements.cameraMessage = document.getElementById("cameraMessage");
    elements.statusText = document.getElementById("statusText");
    elements.pendingCount = document.getElementById("pendingCount");
    elements.uploadingCount = document.getElementById("uploadingCount");
    elements.networkStatus = document.getElementById("networkStatus");
    elements.lastThumb = document.getElementById("lastThumb");
    elements.emptyThumb = document.getElementById("emptyThumb");
    elements.authHint = document.getElementById("authHint");
    elements.recentList = document.getElementById("recentList");
    elements.globalProgress = document.getElementById("globalProgress");
    elements.globalProgressBar = document.getElementById("globalProgressBar");
    elements.globalProgressText = document.getElementById("globalProgressText");
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", requestGoogleToken);
    elements.captureButton.addEventListener("click", openNativeCamera);
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
      if (!document.hidden && isAuthenticated()) {
        processPendingQueue();
      }
    });

    window.addEventListener("pagehide", revokeLastThumbnail);
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

    setStatus(state.pendingCount > 0 ? "Subiendo cola..." : "Camara nativa lista", "ok");
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

  function openNativeCamera() {
    if (state.captureInProgress) {
      return;
    }

    try {
      elements.cameraInput.click();
    } catch (error) {
      console.error(error);
      showCameraError("No se pudo abrir la camara nativa. Toca Disparar otra vez.");
    }
  }

  function showCameraError(message) {
    state.cameraError = message;
    setStatus("Camara nativa no disponible", "warning");
    setCameraMessage(message);
    setHint(message);
    updateControls();
  }

  function setCameraMessage(message) {
    elements.cameraMessage.textContent = message;
  }

  async function handleNativeCapture(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    state.captureInProgress = true;
    state.cameraError = "";
    updateControls();

    try {
      const fileName = makePhotoFileName(new Date(), file);
      await storeCapturedPhoto(file, fileName, "Camara nativa");
      reopenNativeCameraBestEffort();
    } catch (error) {
      console.error(error);
      setStatus("No se pudo encolar", "error");
      setHint("Reintenta la foto. La cola existente no se modifico.");
    } finally {
      state.captureInProgress = false;
      updateControls();
    }
  }

  async function storeCapturedPhoto(file, fileName, sourceLabel) {
    showThumbnail(file);
    const pendingId = await enqueuePhoto(file, fileName);
    addRecentPhoto({
      id: pendingId,
      fileName,
      status: "queued",
      label: sourceLabel,
    });
    setQueuedStatus();
    setHint(isAuthenticated()
      ? "Foto original en cola; la subida sigue en segundo plano."
      : "Foto original guardada. Conecta Google para subir los pendientes.");
    updateControls();

    if (isAuthenticated()) {
      processPendingQueue();
    }
  }

  function reopenNativeCameraBestEffort() {
    window.setTimeout(() => {
      try {
        if (!document.hidden && !state.captureInProgress) {
          elements.cameraInput.click();
        }
      } catch (error) {
        console.debug("El navegador bloqueo la reapertura automatica de la camara nativa.", error);
      }
    }, 0);
  }

  function showThumbnail(blob) {
    revokeLastThumbnail();

    state.lastThumbUrl = URL.createObjectURL(blob);
    elements.lastThumb.src = state.lastThumbUrl;
    elements.lastThumb.hidden = false;
    elements.emptyThumb.hidden = true;
  }

  function revokeLastThumbnail() {
    if (!state.lastThumbUrl) {
      return;
    }

    URL.revokeObjectURL(state.lastThumbUrl);
    state.lastThumbUrl = null;
  }

  function addRecentPhoto(photo) {
    state.recentPhotos = state.recentPhotos.filter((item) => item.id !== photo.id);
    state.recentPhotos.unshift({
      progress: null,
      ...photo,
    });
    trimRecentPhotos();
    renderRecentPhotos();
  }

  function ensureRecentPhoto(photo) {
    const existing = state.recentPhotos.find((item) => item.id === photo.id);
    if (existing) {
      return;
    }

    addRecentPhoto({
      id: photo.id,
      fileName: photo.fileName,
      status: "queued",
      label: "Pendiente",
    });
  }

  function updateRecentPhoto(id, updates) {
    const photo = state.recentPhotos.find((item) => item.id === id);
    if (photo) {
      const patch = typeof updates === "string" ? { status: updates } : updates;
      Object.assign(photo, patch);
      trimRecentPhotos();
      renderRecentPhotos();
    }
  }

  function trimRecentPhotos() {
    const visibleLimit = 6;
    const hardLimit = 12;
    const visible = [];
    const overflow = [];

    state.recentPhotos.forEach((photo) => {
      if (visible.length < visibleLimit || photo.status === "uploading") {
        visible.push(photo);
      } else {
        overflow.push(photo);
      }
    });

    state.recentPhotos = visible.concat(overflow).slice(0, hardLimit);
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

      const info = document.createElement("div");
      info.className = "recent-info";

      const name = document.createElement("span");
      name.className = "recent-name";
      name.textContent = photo.fileName;
      info.appendChild(name);

      if (photo.status === "uploading") {
        const progress = normalizeProgress(photo.progress);
        const progressTrack = document.createElement("div");
        progressTrack.className = "recent-progress";
        progressTrack.setAttribute("role", "progressbar");
        progressTrack.setAttribute("aria-label", `Progreso de subida de ${photo.fileName}`);
        progressTrack.setAttribute("aria-valuemin", "0");
        progressTrack.setAttribute("aria-valuemax", "100");
        progressTrack.setAttribute("aria-valuenow", String(progress));

        const progressBar = document.createElement("span");
        progressBar.style.width = `${progress}%`;
        progressTrack.appendChild(progressBar);
        info.appendChild(progressTrack);
      }

      const badge = document.createElement("span");
      badge.className = "recent-badge";
      badge.textContent = getRecentStatusText(photo);

      item.append(info, badge);
      elements.recentList.appendChild(item);
    });
  }

  function getRecentStatusText(photo) {
    const status = photo.status;
    if (status === "uploading") {
      return `Subiendo ${normalizeProgress(photo.progress)}%`;
    }
    if (status === "done") {
      return "OK";
    }
    if (status === "error") {
      return "Pendiente";
    }
    return "En cola";
  }

  function normalizeProgress(value) {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Math.min(100, Math.max(0, Math.round(value)));
  }

  function setPhotoUploadProgress(id, loaded, total) {
    const safeLoaded = Math.max(0, Number(loaded) || 0);
    const safeTotal = Math.max(0, Number(total) || 0);
    const progress = safeTotal > 0 ? (safeLoaded / safeTotal) * 100 : 0;

    state.uploadProgressById.set(id, {
      loaded: safeLoaded,
      total: safeTotal,
    });
    updateRecentPhoto(id, {
      status: "uploading",
      progress,
    });
    updateGlobalUploadProgress();
  }

  function clearPhotoUploadProgress(id) {
    state.uploadProgressById.delete(id);
    updateGlobalUploadProgress();
  }

  function updateGlobalUploadProgress() {
    if (!elements.globalProgress) {
      return;
    }

    const entries = Array.from(state.uploadProgressById.values());
    if (entries.length === 0) {
      elements.globalProgress.hidden = true;
      elements.globalProgressBar.style.width = "0%";
      elements.globalProgressText.textContent = "0%";
      elements.globalProgress.setAttribute("aria-valuenow", "0");
      return;
    }

    const loaded = entries.reduce((sum, item) => sum + item.loaded, 0);
    const total = entries.reduce((sum, item) => sum + item.total, 0);
    const progress = normalizeProgress(total > 0 ? (loaded / total) * 100 : 0);

    elements.globalProgress.hidden = false;
    elements.globalProgressBar.style.width = `${progress}%`;
    elements.globalProgressText.textContent = `${progress}%`;
    elements.globalProgress.setAttribute("aria-valuenow", String(progress));
  }

  async function uploadPhotoToDrive(blob, fileName, onProgress) {
    let folderId = await getOrCreateFolderId();
    let response = await sendMultipartUpload(folderId, blob, fileName, onProgress);

    if (response.status === 404) {
      localStorage.removeItem(getFolderStorageKey());
      folderId = await getOrCreateFolderId();
      response = await sendMultipartUpload(folderId, blob, fileName, onProgress);
    }

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }

    return response.json();
  }

  async function sendMultipartUpload(folderId, blob, fileName, onProgress) {
    const mimeType = blob.type || "application/octet-stream";
    const metadata = {
      name: fileName,
      parents: [folderId],
    };
    if (blob.type) {
      metadata.mimeType = blob.type;
    }
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

    return authorizedUploadWithProgress(DRIVE_UPLOAD_URL, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }, onProgress);
  }

  function authorizedUploadWithProgress(url, options, onProgress) {
    if (!isAuthenticated()) {
      throw new AuthExpiredError();
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const method = options.method || "GET";
      const headers = new Headers(options.headers || {});

      xhr.open(method, url, true);
      xhr.setRequestHeader("Authorization", `Bearer ${state.accessToken}`);
      headers.forEach((value, key) => {
        xhr.setRequestHeader(key, value);
      });

      xhr.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable && typeof onProgress === "function") {
          onProgress(event.loaded, event.total);
        }
      });

      xhr.addEventListener("load", () => {
        const response = makeXhrResponse(xhr.status, xhr.statusText, xhr.responseText || "");

        if (xhr.status === 401) {
          clearAuth(false);
          reject(new AuthExpiredError("Google solicita reconectar la cuenta."));
          return;
        }

        resolve(response);
      });

      xhr.addEventListener("error", () => {
        reject(new Error("No se pudo conectar con Google Drive."));
      });

      xhr.addEventListener("abort", () => {
        reject(new Error("La subida fue cancelada."));
      });

      xhr.send(options.body || null);
    });
  }

  function makeXhrResponse(status, statusText, bodyText) {
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText,
      text: () => Promise.resolve(bodyText),
      json: () => Promise.resolve(bodyText ? JSON.parse(bodyText) : null),
      clone: () => makeXhrResponse(status, statusText, bodyText),
    };
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

  async function enqueuePhoto(file, fileName) {
    const id = await addPendingPhoto(file, fileName);
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
        setStatus("Camara nativa lista", "ok");
        return;
      }
      const workerCount = Math.min(UPLOAD_CONCURRENCY, queue.length);

      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !authFailed && navigator.onLine) {
          const photo = queue.shift();
          ensureRecentPhoto(photo);
          setPhotoUploadProgress(photo.id, 0, 0);
          state.uploadingCount += 1;
          updateControls();

          try {
            await uploadWithRetries(photo);
            await deletePendingPhoto(photo.id);
            uploadedCount += 1;
            updateRecentPhoto(photo.id, {
              status: "done",
              progress: 100,
            });
            await refreshPendingCount();
          } catch (error) {
            console.error(error);
            if (error instanceof AuthExpiredError) {
              authFailed = true;
              clearAuth(false);
              updateRecentPhoto(photo.id, {
                status: "error",
                progress: null,
              });
            } else {
              failedCount += 1;
              updateRecentPhoto(photo.id, {
                status: "error",
                progress: null,
              });
            }
          } finally {
            clearPhotoUploadProgress(photo.id);
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
        setHint("Las fotos originales pendientes quedaron guardadas en Google Drive.");
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
        await uploadPhotoToDrive(photo.blob, photo.fileName, (loaded, total) => {
          setPhotoUploadProgress(photo.id, loaded, total);
        });
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

  async function addPendingPhoto(file, fileName) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).add({
        blob: file,
        fileName,
        type: file.type || "",
        originalName: file.name || "",
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

  function makePhotoFileName(date, file) {
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
    ].join("-") + getFileExtension(file);
  }

  function getFileExtension(file) {
    const mimeType = (file && file.type ? file.type : "").toLowerCase();
    const extensionsByMimeType = {
      "image/jpeg": ".jpg",
      "image/pjpeg": ".jpg",
      "image/heic": ".heic",
      "image/heif": ".heif",
      "image/png": ".png",
      "image/webp": ".webp",
      "image/gif": ".gif",
      "image/bmp": ".bmp",
      "image/tiff": ".tif",
      "image/avif": ".avif",
      "image/svg+xml": ".svg",
      "image/x-adobe-dng": ".dng",
    };

    if (extensionsByMimeType[mimeType]) {
      return extensionsByMimeType[mimeType];
    }

    const fileName = file && file.name ? file.name : "";
    const extension = fileName.match(/\.[a-z0-9]{1,8}$/i);
    return extension ? extension[0].toLowerCase() : ".img";
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
      setStatus("Camara nativa lista", "ok");
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
    elements.captureButton.disabled = state.captureInProgress;
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
    if (state.cameraError) {
      return state.cameraError;
    }
    if (authenticated && state.pendingCount > 0) {
      return "Los pendientes se subiran automaticamente con conexion.";
    }
    if (authenticated) {
      return "Listo para tomar fotos nativas y subirlas a Drive.";
    }
    if (state.pendingCount > 0) {
      return "Conecta Google para subir pendientes.";
    }
    return "Toca Disparar para abrir la camara nativa trasera.";
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
