(function () {
  "use strict";

  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
  const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
  const DB_NAME = "camtodrive-db";
  const DB_VERSION = 1;
  const STORE_NAME = "pendingPhotos";
  const TOKEN_SAFETY_MS = 30 * 1000;

  const elements = {};
  const state = {
    accessToken: null,
    tokenClient: null,
    tokenExpiresAt: 0,
    tokenExpiryTimer: null,
    gisReady: false,
    isUploading: false,
    isProcessingQueue: false,
    pendingCount: 0,
    lastThumbUrl: null,
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
    updateNetworkStatus();
    registerServiceWorker();

    await refreshPendingCount();
    updateControls();

    if (!hasConfiguredClientId()) {
      setStatus("Conectar Google", "warning");
      elements.authHint.textContent = "Reemplaza el CLIENT_ID en config.js antes de conectar Google.";
      updateControls();
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
      setStatus("Conectar Google");
    } catch (error) {
      console.error(error);
      setStatus("No se pudo cargar Google", "error");
      elements.authHint.textContent = "Revisa la conexion y recarga la app.";
    }

    updateControls();
  }

  function cacheElements() {
    elements.connectButton = document.getElementById("connectButton");
    elements.captureButton = document.getElementById("captureButton");
    elements.cameraInput = document.getElementById("cameraInput");
    elements.statusText = document.getElementById("statusText");
    elements.pendingCount = document.getElementById("pendingCount");
    elements.networkStatus = document.getElementById("networkStatus");
    elements.lastThumb = document.getElementById("lastThumb");
    elements.emptyThumb = document.getElementById("emptyThumb");
    elements.authHint = document.getElementById("authHint");
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", requestGoogleToken);
    elements.captureButton.addEventListener("click", () => elements.cameraInput.click());
    elements.cameraInput.addEventListener("change", handleCameraChange);

    window.addEventListener("online", async () => {
      updateNetworkStatus();
      if (isAuthenticated()) {
        await processPendingQueue();
      }
    });

    window.addEventListener("offline", updateNetworkStatus);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && isAuthenticated()) {
        processPendingQueue();
      }
    });
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
    elements.authHint.textContent = "Esperando autorizacion de Google...";
    state.tokenClient.callback = handleTokenResponse;
    state.tokenClient.requestAccessToken({ prompt: state.accessToken ? "" : "consent" });
  }

  async function handleTokenResponse(response) {
    if (!response || response.error) {
      console.error("Error OAuth", response);
      clearAuth(false);
      setStatus("Conectar Google", "error");
      elements.authHint.textContent = "No se completo la conexion con Google.";
      updateControls();
      return;
    }

    const expiresInMs = Math.max(0, Number(response.expires_in || 3600) * 1000 - TOKEN_SAFETY_MS);
    state.accessToken = response.access_token;
    state.tokenExpiresAt = Date.now() + expiresInMs;
    scheduleTokenExpiry(expiresInMs);

    setStatus("Tomar foto", "ok");
    elements.authHint.textContent = "Conectado a Google Drive con el scope drive.file.";
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
        elements.authHint.textContent = "Reconecta Google para continuar con los pendientes.";
      } else {
        setStatus("Conectar Google", "warning");
        elements.authHint.textContent = "La sesion expiro. Conecta Google otra vez.";
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

  async function handleCameraChange(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    showThumbnail(file);
    const fileName = makePhotoFileName(new Date());

    if (!isAuthenticated()) {
      await enqueuePhoto(file, fileName);
      clearAuth(false);
      setQueuedStatus();
      elements.authHint.textContent = "Conecta Google para subir la foto pendiente.";
      updateControls();
      return;
    }

    state.isUploading = true;
    setStatus("Subiendo...");
    updateControls();

    try {
      await uploadPhotoToDrive(file, fileName);
      setStatus("✓ Subida OK", "ok");
      elements.authHint.textContent = "La foto quedo guardada en Google Drive.";
    } catch (error) {
      console.error(error);
      if (error instanceof AuthExpiredError) {
        clearAuth(false);
      }
      await enqueuePhoto(file, fileName);
      setQueuedStatus();
      elements.authHint.textContent = error instanceof AuthExpiredError
        ? "Reconecta Google para subir la foto pendiente."
        : "La foto se subira automaticamente cuando vuelva la red.";
    } finally {
      state.isUploading = false;
      updateControls();
    }
  }

  function showThumbnail(file) {
    if (state.lastThumbUrl) {
      URL.revokeObjectURL(state.lastThumbUrl);
    }

    state.lastThumbUrl = URL.createObjectURL(file);
    elements.lastThumb.src = state.lastThumbUrl;
    elements.lastThumb.hidden = false;
    elements.emptyThumb.hidden = true;
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
    await addPendingPhoto(blob, fileName);
    await refreshPendingCount();
  }

  async function processPendingQueue() {
    if (state.isProcessingQueue || !navigator.onLine || !isAuthenticated()) {
      await refreshPendingCount();
      return;
    }

    state.isProcessingQueue = true;
    updateControls();

    try {
      const pendingPhotos = await getPendingPhotos();
      for (const photo of pendingPhotos) {
        setStatus("Subiendo...");
        await uploadPhotoToDrive(photo.blob, photo.fileName);
        await deletePendingPhoto(photo.id);
        await refreshPendingCount();
      }

      if (pendingPhotos.length > 0) {
        setStatus("✓ Subida OK", "ok");
        elements.authHint.textContent = "Se subieron las fotos pendientes.";
      }
    } catch (error) {
      console.error(error);
      if (error instanceof AuthExpiredError) {
        clearAuth(false);
        elements.authHint.textContent = "Reconecta Google para subir pendientes.";
      } else {
        elements.authHint.textContent = "Hay pendientes; se reintentara cuando vuelva la red.";
      }
      setQueuedStatus();
    } finally {
      state.isProcessingQueue = false;
      await refreshPendingCount();
      updateControls();
    }
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
    elements.pendingCount.textContent = String(state.pendingCount);
  }

  function makePhotoFileName(date) {
    const pad = (value) => String(value).padStart(2, "0");
    return [
      date.getFullYear(),
      pad(date.getMonth() + 1),
      pad(date.getDate()),
    ].join("-") + "_" + [
      pad(date.getHours()),
      pad(date.getMinutes()),
      pad(date.getSeconds()),
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
    setStatus(`⚠ En cola (${count} ${count === 1 ? "pendiente" : "pendientes"})`, "warning");
  }

  function updateControls() {
    const configured = hasConfiguredClientId();
    const authenticated = isAuthenticated();
    const busy = state.isUploading || state.isProcessingQueue;

    elements.connectButton.disabled = !configured || !state.gisReady || busy;
    elements.connectButton.hidden = authenticated;
    elements.captureButton.disabled = !authenticated || busy;

    if (!configured) {
      elements.authHint.textContent = "Reemplaza el CLIENT_ID en config.js antes de conectar Google.";
    } else if (!state.gisReady) {
      elements.authHint.textContent = "Cargando Google Identity Services...";
    } else if (authenticated && state.pendingCount > 0) {
      elements.authHint.textContent = "Los pendientes se subiran automaticamente con conexion.";
    } else if (authenticated) {
      elements.authHint.textContent = "Listo para tomar fotos y subirlas a Drive.";
    } else if (state.pendingCount > 0) {
      elements.authHint.textContent = "Conecta Google para subir pendientes.";
    } else {
      elements.authHint.textContent = "Conecta Google para habilitar la camara.";
    }
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
