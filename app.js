(function () {
  "use strict";

  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";
  const DRIVE_FILES_URL = "https://www.googleapis.com/drive/v3/files";
  const DRIVE_MULTIPART_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink";
  const DRIVE_RESUMABLE_URL = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink";
  // Google documenta uploadType=multipart para archivos pequenos (hasta ~5 MB).
  // Por encima de ese tamano se usa una sesion resumable.
  const MULTIPART_MAX_BYTES = 5 * 1024 * 1024;
  const UPLOAD_ID_PROPERTY = "camtodriveId";
  const DB_NAME = "camtodrive-db";
  const DB_VERSION = 1;
  const STORE_NAME = "pendingPhotos";
  const TOKEN_SAFETY_MS = 30 * 1000;
  const UPLOAD_CONCURRENCY = 3;
  const MAX_UPLOAD_ATTEMPTS = 3;
  const RETRY_BASE_DELAY_MS = 1200;
  const QUEUE_RETRY_DELAY_MS = 45 * 1000;
  const CONSENT_STORAGE_KEY = "camtodrive.consented";
  const FRESH_FRAME_TIMEOUT_MS = 400;

  const elements = {};
  const state = {
    accessToken: null,
    tokenClient: null,
    tokenExpiresAt: 0,
    tokenExpiryTimer: null,
    gisReady: false,
    isProcessingQueue: false,
    queueProcessRequested: false,
    queueRetryTimer: null,
    pendingCount: 0,
    uploadingCount: 0,
    authHintMessage: "",
    cameraError: "",
    captureInProgress: false,
    deleteArmed: false,
    recentPhotos: [],
    uploadProgressById: new Map(),
    focus: {
      timer: null,
      canvas: null,
      peak: 0,
      stable: 0,
      locked: false,
    },
    preview: {
      open: false,
      blob: null,
      url: null,
      label: "",
      takenAt: null,
    },
    viewerPhoto: {
      open: false,
      photoId: null,
      url: null,
    },
    camera: {
      stream: null,
      track: null,
      imageCapture: null,
      mode: "",
      width: 0,
      height: 0,
      starting: false,
      supported: true,
      suspended: false,
      idleTimer: null,
    },
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

    setCameraMessage("Abriendo la camara...");
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
      setStatus("Conectar Google", "warning");
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
    elements.viewer = document.getElementById("viewer");
    elements.stage = document.getElementById("stage");
    elements.cameraFallback = document.getElementById("cameraFallback");
    elements.retryCameraButton = document.getElementById("retryCameraButton");
    elements.nativeCameraButton = document.getElementById("nativeCameraButton");
    elements.captureQuality = document.getElementById("captureQuality");
    elements.cameraPaused = document.getElementById("cameraPaused");
    elements.focusFrame = document.getElementById("focusFrame");
    elements.statusText = document.getElementById("statusText");
    elements.pendingCount = document.getElementById("pendingCount");
    elements.uploadingCount = document.getElementById("uploadingCount");
    elements.networkStatus = document.getElementById("networkStatus");
    elements.authHint = document.getElementById("authHint");

    elements.preview = document.getElementById("preview");
    elements.previewImage = document.getElementById("previewImage");
    elements.previewMeta = document.getElementById("previewMeta");
    elements.previewAcceptButton = document.getElementById("previewAcceptButton");
    elements.previewRetakeButton = document.getElementById("previewRetakeButton");

    elements.photoViewer = document.getElementById("photoViewer");
    elements.photoViewerImage = document.getElementById("photoViewerImage");
    elements.photoViewerName = document.getElementById("photoViewerName");
    elements.photoViewerMeta = document.getElementById("photoViewerMeta");
    elements.photoViewerWarning = document.getElementById("photoViewerWarning");
    elements.photoViewerDelete = document.getElementById("photoViewerDelete");
    elements.photoViewerOpen = document.getElementById("photoViewerOpen");
    elements.photoViewerClose = document.getElementById("photoViewerClose");
    elements.recentList = document.getElementById("recentList");
    elements.globalProgress = document.getElementById("globalProgress");
    elements.globalProgressBar = document.getElementById("globalProgressBar");
    elements.globalProgressText = document.getElementById("globalProgressText");
  }

  function bindEvents() {
    elements.connectButton.addEventListener("click", requestGoogleToken);
    elements.captureButton.addEventListener("click", capturePhoto);
    elements.retryCameraButton.addEventListener("click", () => startCamera(true));
    elements.nativeCameraButton.addEventListener("click", openNativeCamera);
    elements.cameraInput.addEventListener("change", handleNativeCapture);
    elements.viewer.addEventListener("loadedmetadata", updateCaptureQualityLabel);
    elements.viewer.addEventListener("resize", updateCaptureQualityLabel);

    // Tocar la imagen cuenta como actividad y reanuda la camara si se apago sola.
    elements.stage.addEventListener("click", resumeCameraFromPause);

    elements.previewAcceptButton.addEventListener("click", acceptPreview);
    elements.previewRetakeButton.addEventListener("click", discardPreview);
    elements.photoViewerClose.addEventListener("click", closePhotoViewer);
    elements.photoViewerDelete.addEventListener("click", handleDeleteRequest);

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
        // Liberar la camara al ocultar la app; iOS corta el stream igualmente.
        stopCamera();
        return;
      }

      startCamera();
      if (isAuthenticated()) {
        processPendingQueue();
      }
    });

    window.addEventListener("pagehide", () => {
      stopCamera();
      closePreview();
      closePhotoViewer();
      state.recentPhotos.forEach(releaseRecentPhoto);
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
    setHint("Esperando autorizacion de Google...");
    state.tokenClient.callback = handleTokenResponse;
    // Tras el primer consentimiento se reconecta en silencio en vez de repetir la pantalla.
    state.tokenClient.requestAccessToken({ prompt: hasGrantedConsent() ? "" : "consent" });
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
    rememberConsent();

    setStatus(state.pendingCount > 0 ? "Subiendo cola..." : "Camara lista", "ok");
    setHint("Conectado a Google Drive con el scope Drive completo.");
    updateControls();
    await processPendingQueue();
  }

  function hasGrantedConsent() {
    try {
      return localStorage.getItem(CONSENT_STORAGE_KEY) === "1";
    } catch (_error) {
      return false;
    }
  }

  function rememberConsent() {
    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, "1");
    } catch (_error) {
      // Modo privado: se volvera a pedir el consentimiento, no es un fallo grave.
    }
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

  // ---------------------------------------------------------------------------
  // Camara continua
  // ---------------------------------------------------------------------------

  async function startCamera(isManualRetry = false) {
    if (state.camera.stream || state.camera.starting) {
      return;
    }

    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      state.camera.supported = false;
      showCameraFallback("Este navegador no permite la camara en pagina. Usa la camara nativa.");
      return;
    }

    state.camera.starting = true;
    state.camera.suspended = false;
    elements.cameraPaused.hidden = true;
    if (isManualRetry) {
      state.cameraError = "";
    }
    setCameraMessage("Abriendo la camara...");
    updateControls();

    const config = getAppConfig();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: config.CAPTURE_IDEAL_WIDTH || 4096 },
          height: { ideal: config.CAPTURE_IDEAL_HEIGHT || 3072 },
          // Menos fotogramas por segundo = menos trabajo del ISP = menos bateria.
          frameRate: { ideal: getIdealFrameRate(), max: 30 },
        },
        audio: false,
      });
      await attachCameraStream(stream);
      state.cameraError = "";
      hideCameraFallback();
      if (isAuthenticated()) {
        setStatus("Camara lista", "ok");
      }
    } catch (error) {
      console.error(error);
      showCameraFallback(describeCameraError(error));
    } finally {
      state.camera.starting = false;
      updateControls();
    }
  }

  async function attachCameraStream(stream) {
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("La camara no entrego video.");
    }

    state.camera.stream = stream;
    state.camera.track = track;

    await tuneTrackResolution(track);

    elements.viewer.srcObject = stream;
    elements.viewer.hidden = false;
    try {
      await elements.viewer.play();
    } catch (error) {
      console.debug("El navegador retraso la reproduccion del visor.", error);
    }

    track.addEventListener("ended", handleTrackEnded);
    setupImageCapture(track);
    updateCaptureQualityLabel();
    setCameraMessage("Camara abierta. Dispara las veces que quieras.");
    noteCameraActivity();
    startFocusWatch();
  }

  // Sube el track a la mayor resolucion que declare el dispositivo, pero sin pasar del tope
  // de CAPTURE_MAX_PIXELS: un visor de 12 MP a 30 fps es la mayor fuente de consumo de la app
  // y el aumento de calidad por encima de ~8 MP no se nota en un fotograma de video.
  async function tuneTrackResolution(track) {
    if (typeof track.getCapabilities !== "function") {
      return;
    }

    let capabilities = null;
    try {
      capabilities = track.getCapabilities();
    } catch (error) {
      console.debug("El navegador no expone las capacidades de la camara.", error);
      return;
    }

    const maxWidth = capabilities && capabilities.width ? capabilities.width.max : 0;
    const maxHeight = capabilities && capabilities.height ? capabilities.height.max : 0;
    if (!maxWidth || !maxHeight) {
      return;
    }

    const target = capResolution(maxWidth, maxHeight, getMaxCapturePixels());
    const settings = typeof track.getSettings === "function" ? track.getSettings() : {};
    if (settings.width === target.width && settings.height === target.height) {
      return;
    }

    try {
      await track.applyConstraints({
        width: { ideal: target.width },
        height: { ideal: target.height },
        frameRate: { ideal: getIdealFrameRate(), max: 30 },
      });
    } catch (error) {
      console.debug("La camara no acepto la resolucion pedida.", error);
    }
  }

  // Reduce la resolucion manteniendo la relacion de aspecto hasta caber en el tope.
  function capResolution(width, height, maxPixels) {
    const pixels = width * height;
    if (!maxPixels || pixels <= maxPixels) {
      return { width, height };
    }

    const scale = Math.sqrt(maxPixels / pixels);
    return {
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    };
  }

  function getMaxCapturePixels() {
    const value = Number(getAppConfig().CAPTURE_MAX_PIXELS);
    return Number.isFinite(value) && value > 0 ? value : 0;
  }

  function getIdealFrameRate() {
    const value = Number(getAppConfig().CAPTURE_FRAME_RATE);
    return Number.isFinite(value) && value >= 10 && value <= 60 ? value : 24;
  }

  // ImageCapture entrega una foto real del sensor (sin pasar por canvas).
  // Chrome/Android lo soporta; Safari no, y ahi se usa el fotograma del visor.
  function setupImageCapture(track) {
    state.camera.imageCapture = null;
    state.camera.mode = "frame";

    if (typeof window.ImageCapture !== "function") {
      return;
    }

    try {
      state.camera.imageCapture = new ImageCapture(track);
      state.camera.mode = "photo";
    } catch (error) {
      console.debug("ImageCapture no esta disponible para esta camara.", error);
    }
  }

  // ---------------------------------------------------------------------------
  // Ahorro de bateria: la camara se apaga sola cuando nadie la usa.
  // Un stream abierto sigue consumiendo aunque no se dispare, y es lo que mas
  // gasta de toda la app.
  // ---------------------------------------------------------------------------

  function getCameraIdleMs() {
    const seconds = Number(getAppConfig().CAMERA_IDLE_TIMEOUT_SECONDS);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      return 0;
    }
    return Math.max(15, seconds) * 1000;
  }

  function noteCameraActivity() {
    scheduleCameraIdleSuspend();
  }

  function scheduleCameraIdleSuspend() {
    clearCameraIdleTimer();
    const idleMs = getCameraIdleMs();
    if (!idleMs || !state.camera.stream) {
      return;
    }
    state.camera.idleTimer = window.setTimeout(suspendCameraForIdle, idleMs);
  }

  function clearCameraIdleTimer() {
    if (state.camera.idleTimer) {
      window.clearTimeout(state.camera.idleTimer);
      state.camera.idleTimer = null;
    }
  }

  function suspendCameraForIdle() {
    // Nunca cortar en mitad de un disparo o con la vista previa abierta.
    if (!state.camera.stream || state.captureInProgress || state.preview.open) {
      scheduleCameraIdleSuspend();
      return;
    }

    stopCamera();
    state.camera.suspended = true;
    elements.cameraPaused.hidden = false;
    setStatus("Camara en pausa", "warning");
    setHint("La camara se apago para ahorrar bateria. Toca la pantalla para reanudarla.");
    updateControls();
  }

  function resumeCameraFromPause() {
    if (!state.camera.suspended) {
      noteCameraActivity();
      return;
    }
    startCamera(true);
  }

  // ---------------------------------------------------------------------------
  // Indicador de foco
  //
  // Ni Safari ni iOS exponen el estado del autofoco (no hay focusMode fiable), asi que
  // el foco se MIDE sobre la imagen: se recorta el centro del fotograma a resolucion
  // nativa y se suma la energia de gradiente (|dL/dx| + |dL/dy| de la luminancia). Una
  // imagen desenfocada es una imagen filtrada por paso bajo: sus bordes son suaves y esa
  // suma cae. El recorte va sin reescalar porque reducir la imagen promedia justamente el
  // detalle fino que se quiere medir.
  //
  // El umbral es relativo a un maximo movil que decae, no absoluto: cada escena tiene su
  // propio nivel de detalle y lo que importa es si esta en su mejor punto de foco.
  //
  // El cambio de estado usa histeresis (entra en verde con 0.82, sale con 0.70) y exige dos
  // lecturas seguidas en ambos sentidos: sin eso el marco parpadea con el pulso de la mano.
  // ---------------------------------------------------------------------------

  const FOCUS_INTERVAL_SEARCHING_MS = 300;
  // Una vez fijado no hace falta mirar tan seguido: media el ritmo y se ahorra bateria.
  const FOCUS_INTERVAL_LOCKED_MS = 700;
  const FOCUS_CROP_WIDTH = 256;
  const FOCUS_CROP_HEIGHT = 192;
  const FOCUS_LOCK_RATIO = 0.82;
  const FOCUS_UNLOCK_RATIO = 0.7;
  const FOCUS_PEAK_DECAY = 0.97;
  const FOCUS_MIN_ENERGY = 1.5;
  const FOCUS_STABLE_SAMPLES = 2;
  // Se miden uno de cada dos pixeles, pero la diferencia se sigue tomando contra el vecino
  // inmediato: se muestrea menos, no se mide mas grueso. La media converge igual y el
  // trabajo por lectura baja a la cuarta parte.
  const FOCUS_SAMPLE_STEP = 2;

  function startFocusWatch() {
    stopFocusWatch();
    if (!elements.focusFrame) {
      return;
    }

    state.focus.peak = 0;
    state.focus.stable = 0;
    state.focus.locked = false;
    elements.focusFrame.hidden = false;
    setFocusState("searching");
    queueFocusSample();
  }

  function queueFocusSample() {
    const delay = state.focus.locked ? FOCUS_INTERVAL_LOCKED_MS : FOCUS_INTERVAL_SEARCHING_MS;
    state.focus.timer = window.setTimeout(runFocusSample, delay);
  }

  function runFocusSample() {
    state.focus.timer = null;
    if (!state.camera.stream) {
      return;
    }
    sampleFocus();
    queueFocusSample();
  }

  function stopFocusWatch() {
    if (state.focus.timer) {
      window.clearTimeout(state.focus.timer);
      state.focus.timer = null;
    }
    if (elements.focusFrame) {
      elements.focusFrame.hidden = true;
    }
    state.focus.locked = false;
  }

  function setFocusState(mode) {
    if (!elements.focusFrame) {
      return;
    }
    elements.focusFrame.classList.toggle("locked", mode === "locked");
    elements.focusFrame.classList.toggle("searching", mode !== "locked");
  }

  function sampleFocus() {
    if (document.hidden || state.preview.open) {
      return;
    }

    const energy = measureCenterSharpness(elements.viewer);
    if (energy === null) {
      return;
    }

    // El pico decae para que la medida se readapte al cambiar de escena.
    state.focus.peak = Math.max(state.focus.peak * FOCUS_PEAK_DECAY, energy);

    const ratio = state.focus.peak > 0 ? energy / state.focus.peak : 0;
    // Histeresis: cuesta mas soltar el foco que fijarlo.
    const threshold = state.focus.locked ? FOCUS_UNLOCK_RATIO : FOCUS_LOCK_RATIO;
    const sharp = energy >= FOCUS_MIN_ENERGY && ratio >= threshold;

    if (sharp === state.focus.locked) {
      state.focus.stable = 0;
      return;
    }

    // Solo se cambia de estado tras varias lecturas seguidas que lo confirmen.
    state.focus.stable += 1;
    if (state.focus.stable < FOCUS_STABLE_SAMPLES) {
      return;
    }

    state.focus.stable = 0;
    state.focus.locked = sharp;
    setFocusState(sharp ? "locked" : "searching");
  }

  function measureCenterSharpness(video) {
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      return null;
    }

    const cropWidth = Math.min(FOCUS_CROP_WIDTH, width);
    const cropHeight = Math.min(FOCUS_CROP_HEIGHT, height);
    const canvas = getFocusCanvas(cropWidth, cropHeight);
    const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    if (!context) {
      return null;
    }

    try {
      context.drawImage(
        video,
        Math.round((width - cropWidth) / 2),
        Math.round((height - cropHeight) / 2),
        cropWidth,
        cropHeight,
        0,
        0,
        cropWidth,
        cropHeight
      );
    } catch (_error) {
      return null;
    }

    let data = null;
    try {
      data = context.getImageData(0, 0, cropWidth, cropHeight).data;
    } catch (_error) {
      return null;
    }

    const rowBytes = cropWidth * 4;
    let sum = 0;
    let samples = 0;
    for (let y = 0; y < cropHeight - 1; y += FOCUS_SAMPLE_STEP) {
      for (let x = 0; x < cropWidth - 1; x += FOCUS_SAMPLE_STEP) {
        const index = (y * cropWidth + x) * 4;
        const luma = luminance(data, index);
        const right = luminance(data, index + 4);
        const below = luminance(data, index + rowBytes);
        sum += Math.abs(right - luma) + Math.abs(below - luma);
        samples += 1;
      }
    }

    return samples > 0 ? sum / samples : null;
  }

  function luminance(data, index) {
    return 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
  }

  function getFocusCanvas(width, height) {
    if (!state.focus.canvas) {
      state.focus.canvas = document.createElement("canvas");
    }
    if (state.focus.canvas.width !== width || state.focus.canvas.height !== height) {
      state.focus.canvas.width = width;
      state.focus.canvas.height = height;
    }
    return state.focus.canvas;
  }

  function handleTrackEnded(event) {
    // Ignora el 'ended' de un track viejo cuando ya se reabrio la camara.
    if (event && event.target && event.target !== state.camera.track) {
      return;
    }

    stopCamera();
    if (!document.hidden) {
      showCameraFallback("La camara se cerro. Toca Reintentar camara.");
    }
  }

  function stopCamera() {
    clearCameraIdleTimer();
    stopFocusWatch();
    const stream = state.camera.stream;
    if (state.camera.track) {
      state.camera.track.removeEventListener("ended", handleTrackEnded);
    }
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
    }

    state.camera.stream = null;
    state.camera.track = null;
    state.camera.imageCapture = null;
    state.camera.mode = "";
    state.camera.width = 0;
    state.camera.height = 0;

    if (elements.viewer) {
      elements.viewer.srcObject = null;
      elements.viewer.hidden = true;
    }
    updateCaptureQualityLabel();
  }

  function describeCameraError(error) {
    const name = error && error.name ? error.name : "";
    if (name === "NotAllowedError" || name === "SecurityError") {
      return "Permiso de camara denegado. Autorizalo en el navegador o usa la camara nativa.";
    }
    if (name === "NotFoundError" || name === "OverconstrainedError") {
      return "No se encontro una camara compatible. Usa la camara nativa.";
    }
    if (name === "NotReadableError") {
      return "Otra app esta usando la camara. Cierrala y toca Reintentar camara.";
    }
    return "No se pudo abrir la camara en pagina. Usa la camara nativa.";
  }

  function showCameraFallback(message) {
    state.cameraError = message;
    elements.cameraFallback.hidden = false;
    if (elements.viewer) {
      elements.viewer.hidden = true;
    }
    setStatus("Camara en pagina no disponible", "warning");
    setCameraMessage(message);
    setHint(message);
    updateControls();
  }

  function hideCameraFallback() {
    elements.cameraFallback.hidden = true;
  }

  function setCameraMessage(message) {
    elements.cameraMessage.textContent = message;
  }

  function updateCaptureQualityLabel() {
    if (!elements.captureQuality) {
      return;
    }

    if (!state.camera.stream) {
      elements.captureQuality.hidden = true;
      elements.captureQuality.textContent = "";
      return;
    }

    const width = elements.viewer.videoWidth || 0;
    const height = elements.viewer.videoHeight || 0;
    state.camera.width = width;
    state.camera.height = height;

    if (!width || !height) {
      elements.captureQuality.hidden = true;
      return;
    }

    const megapixels = (width * height) / 1e6;
    const modeLabel = state.camera.mode === "photo"
      ? "foto del sensor"
      : "fotograma recomprimido";
    elements.captureQuality.hidden = false;
    // En el chip solo cabe lo esencial; el detalle queda en el title.
    elements.captureQuality.textContent = `${megapixels.toFixed(1)} MP`;
    elements.captureQuality.title = `${width}x${height} · ${megapixels.toFixed(1)} MP · ${modeLabel}`;
  }

  async function capturePhoto() {
    if (state.captureInProgress || state.preview.open) {
      return;
    }

    if (state.camera.suspended) {
      // Primer toque tras la pausa: reabrir la camara en vez de disparar a ciegas.
      resumeCameraFromPause();
      return;
    }

    if (!state.camera.stream) {
      // Sin visor disponible se cae a la camara nativa del sistema.
      openNativeCamera();
      return;
    }

    state.captureInProgress = true;
    updateControls();

    const takenAt = new Date();
    try {
      const captured = await grabPhotoBlob();
      noteCameraActivity();
      updateCaptureQualityLabel();

      if (shouldConfirmBeforeUpload()) {
        openPreview(captured.blob, captured.label, takenAt);
      } else {
        await acceptCapturedPhoto(captured.blob, captured.label, takenAt);
      }
    } catch (error) {
      console.error(error);
      setStatus("No se pudo capturar", "error");
      setHint("Reintenta el disparo. La cola existente no se modifico.");
    } finally {
      state.captureInProgress = false;
      updateControls();
    }
  }

  async function acceptCapturedPhoto(blob, label, takenAt) {
    const fileName = makePhotoFileName(takenAt || new Date(), blob);
    await storeCapturedPhoto(blob, fileName, label);
  }

  // ---------------------------------------------------------------------------
  // Vista previa: nada llega a la cola sin que el usuario la acepte.
  // ---------------------------------------------------------------------------

  function shouldConfirmBeforeUpload() {
    return getAppConfig().CONFIRM_BEFORE_UPLOAD !== false;
  }

  function openPreview(blob, label, takenAt) {
    closePreview();

    state.preview.open = true;
    state.preview.blob = blob;
    state.preview.label = label || "";
    state.preview.takenAt = takenAt || new Date();
    state.preview.url = URL.createObjectURL(blob);

    elements.previewImage.src = state.preview.url;
    elements.previewMeta.textContent = `${label || "Foto"} · ${formatBytes(blob.size)}`;
    elements.preview.hidden = false;
    setStatus("Revisa la foto", "warning");
    setHint("Usar foto la manda a la cola; Repetir la descarta.");
    pauseViewerPlayback();
    updateControls();
  }

  function closePreview() {
    const wasOpen = state.preview.open;

    if (state.preview.url) {
      URL.revokeObjectURL(state.preview.url);
    }
    state.preview.open = false;
    state.preview.blob = null;
    state.preview.url = null;
    state.preview.label = "";

    if (elements.preview) {
      elements.preview.hidden = true;
      elements.previewImage.removeAttribute("src");
    }

    if (wasOpen) {
      resumeViewerPlayback();
    }
  }

  // Con un overlay a pantalla completa encima, el visor sigue decodificando fotogramas que
  // nadie ve, y ademas el desenfoque del overlay se recalcula con cada uno. Pausarlo corta
  // las dos cosas; la camara sigue abierta, asi que volver es instantaneo.
  function pauseViewerPlayback() {
    if (elements.viewer && !elements.viewer.paused) {
      elements.viewer.pause();
    }
  }

  function resumeViewerPlayback() {
    if (!elements.viewer || !state.camera.stream || !elements.viewer.paused) {
      return;
    }
    const played = elements.viewer.play();
    if (played && typeof played.catch === "function") {
      played.catch((error) => console.debug("El visor no reanudo la reproduccion.", error));
    }
  }

  async function acceptPreview() {
    if (!state.preview.open || !state.preview.blob) {
      return;
    }

    const blob = state.preview.blob;
    const label = state.preview.label;
    const takenAt = state.preview.takenAt;

    // Se suelta la referencia del preview antes de encolar para no duplicar el blob.
    state.preview.blob = null;
    closePreview();

    try {
      await acceptCapturedPhoto(blob, label, takenAt);
    } catch (error) {
      console.error(error);
      setStatus("No se pudo encolar", "error");
      setHint("Reintenta el disparo. La cola existente no se modifico.");
    } finally {
      noteCameraActivity();
      updateControls();
    }
  }

  function discardPreview() {
    closePreview();
    setQueuedStatus();
    setHint("Foto descartada. Dispara otra vez.");
    noteCameraActivity();
    updateControls();
  }

  async function grabPhotoBlob() {
    if (state.camera.imageCapture) {
      try {
        const blob = await takeMaxResolutionPhoto(state.camera.imageCapture);
        if (blob && blob.size > 0) {
          return { blob, label: "Foto del sensor" };
        }
      } catch (error) {
        console.debug("takePhoto fallo; se usa el fotograma del visor.", error);
      }
    }

    return { blob: await grabVideoFrameBlob(), label: "Fotograma del visor" };
  }

  async function takeMaxResolutionPhoto(imageCapture) {
    let photoSettings = null;
    try {
      const capabilities = await imageCapture.getPhotoCapabilities();
      if (capabilities && capabilities.imageWidth && capabilities.imageHeight) {
        photoSettings = {
          imageWidth: capabilities.imageWidth.max,
          imageHeight: capabilities.imageHeight.max,
        };
      }
    } catch (error) {
      console.debug("No se pudieron leer las capacidades de foto.", error);
    }

    return photoSettings ? imageCapture.takePhoto(photoSettings) : imageCapture.takePhoto();
  }

  async function grabVideoFrameBlob() {
    const video = elements.viewer;
    const width = video.videoWidth;
    const height = video.videoHeight;

    if (!width || !height) {
      throw new Error("El visor todavia no tiene imagen.");
    }

    await waitForFreshFrame(video);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("El navegador no permitio dibujar el fotograma.");
    }
    context.drawImage(video, 0, 0, width, height);

    const blob = await canvasToBlob(canvas, "image/jpeg", getCaptureQuality());
    if (!blob) {
      throw new Error("No se pudo generar la imagen del fotograma.");
    }
    return blob;
  }

  function getCaptureQuality() {
    const quality = Number(getAppConfig().CAPTURE_QUALITY);
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
      return 1;
    }
    return quality;
  }

  // Espera al siguiente fotograma pintado para no capturar uno viejo del buffer.
  function waitForFreshFrame(video) {
    if (typeof video.requestVideoFrameCallback !== "function") {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (!settled) {
          settled = true;
          resolve();
        }
      };

      video.requestVideoFrameCallback(finish);
      window.setTimeout(finish, FRESH_FRAME_TIMEOUT_MS);
    });
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (typeof canvas.toBlob !== "function") {
        reject(new Error("El navegador no soporta canvas.toBlob."));
        return;
      }
      canvas.toBlob(resolve, type, quality);
    });
  }

  // ---------------------------------------------------------------------------
  // Camara nativa (fallback)
  // ---------------------------------------------------------------------------

  function openNativeCamera() {
    if (state.captureInProgress) {
      return;
    }

    try {
      elements.cameraInput.click();
    } catch (error) {
      console.error(error);
      showCameraFallback("No se pudo abrir la camara nativa. Toca Disparar otra vez.");
    }
  }

  async function handleNativeCapture(event) {
    const file = event.target.files && event.target.files[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    state.captureInProgress = true;
    updateControls();

    try {
      const takenAt = new Date();
      if (shouldConfirmBeforeUpload()) {
        openPreview(file, "Camara nativa", takenAt);
      } else {
        await acceptCapturedPhoto(file, "Camara nativa", takenAt);
      }
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
    // La miniatura se genera una sola vez y pesa unos pocos KB: guardar el blob completo
    // de cada foto reciente en memoria reventaria un telefono en pocas fotos.
    const thumbUrl = await createThumbnailUrl(file);
    const pendingId = await enqueuePhoto(file, fileName);
    addRecentPhoto({
      id: pendingId,
      fileName,
      status: "queued",
      label: sourceLabel,
      thumbUrl,
      size: file.size,
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

  const THUMBNAIL_MAX_SIDE = 320;

  async function createThumbnailUrl(blob) {
    try {
      const bitmap = await decodeImage(blob);
      if (!bitmap) {
        return null;
      }

      const width = bitmap.width || bitmap.naturalWidth;
      const height = bitmap.height || bitmap.naturalHeight;
      const scale = Math.min(1, THUMBNAIL_MAX_SIDE / Math.max(width, height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));

      const context = canvas.getContext("2d", { alpha: false });
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      if (typeof bitmap.close === "function") {
        bitmap.close();
      }

      const thumbBlob = await canvasToBlob(canvas, "image/jpeg", 0.7);
      return thumbBlob ? URL.createObjectURL(thumbBlob) : null;
    } catch (error) {
      console.debug("No se pudo generar la miniatura.", error);
      return null;
    }
  }

  function decodeImage(blob) {
    if (typeof createImageBitmap === "function") {
      return createImageBitmap(blob).catch(() => decodeImageWithTag(blob));
    }
    return decodeImageWithTag(blob);
  }

  // Respaldo para formatos que createImageBitmap no decodifica (HEIC en Safari).
  function decodeImageWithTag(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        resolve(null);
      };
      image.src = url;
    });
  }

  function addRecentPhoto(photo) {
    state.recentPhotos = state.recentPhotos.filter((item) => item.id !== photo.id);
    state.recentPhotos.unshift({
      progress: null,
      thumbUrl: null,
      driveFileId: null,
      webViewLink: null,
      size: 0,
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

      // Si esa foto esta abierta en el visor, sus botones deben seguir el cambio de estado.
      if (state.viewerPhoto.open && state.viewerPhoto.photoId === id) {
        updatePhotoViewerActions(photo);
        elements.photoViewerMeta.textContent = [
          getRecentStatusText(photo),
          photo.size ? formatBytes(photo.size) : "",
        ].filter(Boolean).join(" · ");
      }
    }
  }

  const RECENT_LIMIT = 12;

  function trimRecentPhotos() {
    const kept = state.recentPhotos.slice(0, RECENT_LIMIT);
    // Las miniaturas que salen de la tira se liberan: si no, cada foto deja memoria retenida.
    state.recentPhotos.slice(RECENT_LIMIT).forEach(releaseRecentPhoto);
    state.recentPhotos = kept;
  }

  function releaseRecentPhoto(photo) {
    if (photo && photo.thumbUrl) {
      URL.revokeObjectURL(photo.thumbUrl);
      photo.thumbUrl = null;
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
      item.textContent = "Sin fotos todavia";
      elements.recentList.appendChild(item);
      return;
    }

    state.recentPhotos.forEach((photo) => {
      const item = document.createElement("li");
      item.className = `shot ${photo.status}`;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "shot-button";
      button.setAttribute("aria-label", `Ver ${photo.fileName}`);
      button.addEventListener("click", () => openPhotoViewer(photo.id));

      if (photo.thumbUrl) {
        const image = document.createElement("img");
        image.src = photo.thumbUrl;
        image.alt = "";
        button.appendChild(image);
      } else {
        const placeholder = document.createElement("span");
        placeholder.className = "shot-placeholder";
        placeholder.textContent = "IMG";
        button.appendChild(placeholder);
      }

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
        button.appendChild(progressTrack);
      }

      const badge = document.createElement("span");
      badge.className = "shot-badge";
      badge.textContent = getRecentStatusIcon(photo);
      badge.title = getRecentStatusText(photo);
      button.appendChild(badge);

      item.appendChild(button);
      elements.recentList.appendChild(item);
    });
  }

  function getRecentStatusIcon(photo) {
    const status = photo.status;
    if (status === "uploading") {
      return `${normalizeProgress(photo.progress)}%`;
    }
    if (status === "done") {
      return "OK";
    }
    if (status === "error") {
      return "!";
    }
    return "···";
  }

  function getRecentStatusText(photo) {
    const status = photo.status;
    if (status === "uploading") {
      return `Subiendo ${normalizeProgress(photo.progress)}%`;
    }
    if (status === "done") {
      return "Subida a Drive";
    }
    if (status === "error") {
      return "Pendiente de reintento";
    }
    return "En cola";
  }

  // ---------------------------------------------------------------------------
  // Visor de una foto del historial: ver en grande y borrar.
  // ---------------------------------------------------------------------------

  async function openPhotoViewer(photoId) {
    const photo = state.recentPhotos.find((item) => item.id === photoId);
    if (!photo) {
      return;
    }

    closePhotoViewer();
    state.viewerPhoto.open = true;
    state.viewerPhoto.photoId = photoId;

    elements.photoViewer.hidden = false;
    elements.photoViewerName.textContent = photo.fileName;
    elements.photoViewerMeta.textContent = [
      getRecentStatusText(photo),
      photo.size ? formatBytes(photo.size) : "",
    ].filter(Boolean).join(" · ");
    elements.photoViewerImage.src = photo.thumbUrl || "";
    resetDeleteConfirmation();
    updatePhotoViewerActions(photo);
    pauseViewerPlayback();
    updateControls();

    // Si la foto sigue en la cola, su original esta en IndexedDB: se muestra en grande.
    if (photo.status !== "done") {
      try {
        const pending = await getPendingPhoto(photoId);
        if (pending && pending.blob && state.viewerPhoto.photoId === photoId) {
          state.viewerPhoto.url = URL.createObjectURL(pending.blob);
          elements.photoViewerImage.src = state.viewerPhoto.url;
        }
      } catch (error) {
        console.debug("No se pudo leer la foto original.", error);
      }
    }
  }

  function updatePhotoViewerActions(photo) {
    const isUploaded = photo.status === "done";
    const isUploading = photo.status === "uploading";

    elements.photoViewerOpen.hidden = !photo.webViewLink;
    if (photo.webViewLink) {
      elements.photoViewerOpen.href = photo.webViewLink;
    }

    if (isUploading) {
      // Borrarla a mitad de la subida dejaria el archivo a medias en Drive.
      elements.photoViewerDelete.textContent = "Subiendo...";
      elements.photoViewerDelete.disabled = true;
      return;
    }

    elements.photoViewerDelete.textContent = isUploaded
      ? "Eliminar de Drive"
      : "Eliminar de la cola";
    // Sin id de Drive no hay nada que borrar alla: se evita prometer lo que no se puede.
    elements.photoViewerDelete.disabled = isUploaded && !photo.driveFileId;
  }

  function closePhotoViewer() {
    const wasOpen = state.viewerPhoto.open;

    if (state.viewerPhoto.url) {
      URL.revokeObjectURL(state.viewerPhoto.url);
      state.viewerPhoto.url = null;
    }
    state.viewerPhoto.open = false;
    state.viewerPhoto.photoId = null;

    if (elements.photoViewer) {
      elements.photoViewer.hidden = true;
      elements.photoViewerImage.removeAttribute("src");
      resetDeleteConfirmation();
    }

    if (wasOpen) {
      resumeViewerPlayback();
    }
  }

  function resetDeleteConfirmation() {
    state.deleteArmed = false;
    if (elements.photoViewerDelete) {
      elements.photoViewerDelete.classList.remove("armed");
    }
    if (elements.photoViewerWarning) {
      elements.photoViewerWarning.hidden = true;
    }
  }

  async function handleDeleteRequest() {
    const photo = state.recentPhotos.find((item) => item.id === state.viewerPhoto.photoId);
    if (!photo) {
      return;
    }

    // Borrar es irreversible desde la app: se pide un segundo toque.
    if (!state.deleteArmed) {
      state.deleteArmed = true;
      elements.photoViewerDelete.classList.add("armed");
      elements.photoViewerDelete.textContent = "Confirmar";
      elements.photoViewerWarning.hidden = false;
      elements.photoViewerWarning.textContent = photo.status === "done"
        ? "La foto se mandara a la papelera de Drive (recuperable 30 dias)."
        : "La foto se borrara del telefono y no se subira.";
      return;
    }

    elements.photoViewerDelete.disabled = true;
    try {
      if (photo.status === "done") {
        await trashDriveFile(photo.driveFileId);
      } else {
        await deletePendingPhoto(photo.id);
        await refreshPendingCount();
      }

      releaseRecentPhoto(photo);
      state.recentPhotos = state.recentPhotos.filter((item) => item.id !== photo.id);
      renderRecentPhotos();
      closePhotoViewer();
      setStatus(photo.status === "done" ? "Foto eliminada" : "Foto descartada", "ok");
      setHint(photo.status === "done"
        ? "La foto quedo en la papelera de Google Drive."
        : "La foto salio de la cola y no se subira.");
    } catch (error) {
      console.error(error);
      elements.photoViewerWarning.hidden = false;
      elements.photoViewerWarning.textContent = error instanceof AuthExpiredError
        ? "Reconecta Google para poder borrar en Drive."
        : "No se pudo eliminar. Reintenta.";
      resetDeleteConfirmation();
      updatePhotoViewerActions(photo);
    } finally {
      elements.photoViewerDelete.disabled = false;
      updateControls();
    }
  }

  // Se manda a la papelera en vez de borrar definitivamente: un toque de mas no puede
  // costar una foto irrecuperable.
  async function trashDriveFile(fileId) {
    if (!fileId) {
      throw new Error("La foto no tiene identificador en Drive.");
    }

    const response = await authorizedFetch(`${DRIVE_FILES_URL}/${encodeURIComponent(fileId)}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
      },
      body: JSON.stringify({ trashed: true }),
    });

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }
  }

  function formatBytes(bytes) {
    const size = Number(bytes) || 0;
    if (size >= 1024 * 1024) {
      return `${(size / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${Math.max(1, Math.round(size / 1024))} KB`;
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

  // ---------------------------------------------------------------------------
  // Subida a Drive
  // ---------------------------------------------------------------------------

  async function uploadPhotoToDrive(blob, fileName, uploadId, onProgress) {
    const folderId = await getOrCreateFolderId();

    if (blob.size > MULTIPART_MAX_BYTES) {
      return uploadResumable(folderId, blob, fileName, uploadId, onProgress);
    }
    return uploadMultipart(folderId, blob, fileName, uploadId, onProgress);
  }

  function buildFileMetadata(folderId, blob, fileName, uploadId) {
    const metadata = {
      name: fileName,
      parents: [folderId],
      appProperties: {
        [UPLOAD_ID_PROPERTY]: uploadId,
      },
    };
    if (blob.type) {
      metadata.mimeType = blob.type;
    }
    return metadata;
  }

  async function uploadMultipart(folderId, blob, fileName, uploadId, onProgress) {
    let response = await sendMultipartUpload(folderId, blob, fileName, uploadId, onProgress);

    // Solo tiene sentido reintentar con otra carpeta cuando la carpeta se resolvio por nombre.
    if (response.status === 404 && !getAppConfig().FOLDER_ID) {
      localStorage.removeItem(getFolderStorageKey());
      const freshFolderId = await getOrCreateFolderId();
      response = await sendMultipartUpload(freshFolderId, blob, fileName, uploadId, onProgress);
    }

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }

    return response.json();
  }

  async function sendMultipartUpload(folderId, blob, fileName, uploadId, onProgress) {
    const mimeType = blob.type || "application/octet-stream";
    const boundary = makeBoundary();
    const body = new Blob(
      [
        `--${boundary}\r\n`,
        "Content-Type: application/json; charset=UTF-8\r\n\r\n",
        JSON.stringify(buildFileMetadata(folderId, blob, fileName, uploadId)),
        `\r\n--${boundary}\r\n`,
        `Content-Type: ${mimeType}\r\n\r\n`,
        blob,
        `\r\n--${boundary}--`,
      ],
      { type: `multipart/related; boundary=${boundary}` }
    );

    return authorizedUploadWithProgress(DRIVE_MULTIPART_URL, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }, onProgress);
  }

  // Sesion resumable para archivos grandes (multipart solo cubre hasta ~5 MB).
  async function uploadResumable(folderId, blob, fileName, uploadId, onProgress) {
    const mimeType = blob.type || "application/octet-stream";
    const session = await authorizedFetch(DRIVE_RESUMABLE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": mimeType,
        "X-Upload-Content-Length": String(blob.size),
      },
      body: JSON.stringify(buildFileMetadata(folderId, blob, fileName, uploadId)),
    });

    if (!session.ok) {
      throw new Error(await getResponseMessage(session));
    }

    const sessionUrl = session.headers.get("Location");
    if (!sessionUrl) {
      throw new Error("Google no devolvio la sesion de subida.");
    }

    const response = await authorizedUploadWithProgress(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      body: blob,
    }, onProgress);

    if (!response.ok) {
      throw new Error(await getResponseMessage(response));
    }

    return response.json();
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

  // Evita duplicados: si un intento anterior llego a Drive pero se perdio la respuesta,
  // el archivo ya esta marcado con su uploadId.
  async function findUploadedPhoto(uploadId) {
    if (!uploadId) {
      return null;
    }

    const query = [
      `appProperties has { key='${UPLOAD_ID_PROPERTY}' and value='${escapeDriveQueryValue(uploadId)}' }`,
      "trashed=false",
    ].join(" and ");
    const params = new URLSearchParams({
      q: query,
      spaces: "drive",
      fields: "files(id,name,webViewLink)",
      pageSize: "1",
    });

    const response = await authorizedFetch(`${DRIVE_FILES_URL}?${params.toString()}`);
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data && data.files && data.files.length > 0 ? data.files[0] : null;
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

  // ---------------------------------------------------------------------------
  // Cola
  // ---------------------------------------------------------------------------

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

    clearQueueRetry();
    state.isProcessingQueue = true;
    state.queueProcessRequested = false;
    setStatus("Subiendo cola...");
    updateControls();

    let uploadedCount = 0;
    let failedCount = 0;
    let authFailed = false;

    try {
      // Solo se cargan las claves: cada blob se lee justo antes de subirlo para no
      // tener toda la cola en memoria a la vez.
      const queue = await getPendingPhotoIds();
      if (queue.length === 0) {
        setStatus("Camara lista", "ok");
        return;
      }
      const workerCount = Math.min(UPLOAD_CONCURRENCY, queue.length);

      const workers = Array.from({ length: workerCount }, async () => {
        while (queue.length > 0 && !authFailed && navigator.onLine) {
          const pendingId = queue.shift();
          let photo = null;

          try {
            photo = await getPendingPhoto(pendingId);
          } catch (error) {
            console.error(error);
          }

          if (!photo || !photo.blob) {
            continue;
          }

          ensureRecentPhoto(photo);
          setPhotoUploadProgress(photo.id, 0, 0);
          state.uploadingCount += 1;
          updateControls();

          try {
            await ensureUploadId(photo);
            const uploaded = await uploadWithRetries(photo);
            await deletePendingPhoto(photo.id);
            uploadedCount += 1;
            updateRecentPhoto(photo.id, {
              status: "done",
              progress: 100,
              // Se guarda el id de Drive para poder borrar la foto despues de subida.
              driveFileId: uploaded && uploaded.id ? uploaded.id : null,
              webViewLink: uploaded && uploaded.webViewLink ? uploaded.webViewLink : null,
            });
            await refreshPendingCount();
          } catch (error) {
            console.error(error);
            if (error instanceof AuthExpiredError) {
              authFailed = true;
              clearAuth(false);
            } else {
              failedCount += 1;
            }
            updateRecentPhoto(photo.id, {
              status: "error",
              progress: null,
            });
          } finally {
            clearPhotoUploadProgress(photo.id);
            state.uploadingCount = Math.max(0, state.uploadingCount - 1);
            photo.blob = null;
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
        setHint("Hay pendientes; se reintentara solo en menos de un minuto.");
        scheduleQueueRetry();
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

  // Reintento automatico aunque no cambie la conectividad ni la visibilidad.
  function scheduleQueueRetry() {
    if (state.queueRetryTimer) {
      return;
    }

    state.queueRetryTimer = window.setTimeout(() => {
      state.queueRetryTimer = null;
      if (navigator.onLine && isAuthenticated() && state.pendingCount > 0) {
        processPendingQueue();
      }
    }, QUEUE_RETRY_DELAY_MS);
  }

  function clearQueueRetry() {
    if (state.queueRetryTimer) {
      window.clearTimeout(state.queueRetryTimer);
      state.queueRetryTimer = null;
    }
  }

  async function ensureUploadId(photo) {
    if (photo.uploadId) {
      return photo.uploadId;
    }

    photo.uploadId = makeUploadId();
    try {
      await updatePendingPhoto(photo);
    } catch (error) {
      // Si no se pudo persistir, la subida sigue: solo se pierde el anti-duplicado.
      console.debug("No se pudo guardar el identificador de subida.", error);
    }
    return photo.uploadId;
  }

  async function uploadWithRetries(photo) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
      try {
        if (attempt > 1) {
          const alreadyUploaded = await findUploadedPhoto(photo.uploadId);
          if (alreadyUploaded) {
            return alreadyUploaded;
          }
        }

        return await uploadPhotoToDrive(photo.blob, photo.fileName, photo.uploadId, (loaded, total) => {
          setPhotoUploadProgress(photo.id, loaded, total);
        });
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

  // ---------------------------------------------------------------------------
  // IndexedDB
  // ---------------------------------------------------------------------------

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
        uploadId: makeUploadId(),
        createdAt: Date.now(),
      });

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getPendingPhotoIds() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).getAllKeys();
      request.onsuccess = () => {
        const keys = request.result || [];
        keys.sort((a, b) => a - b);
        resolve(keys);
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function getPendingPhoto(id) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const request = tx.objectStore(STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async function updatePendingPhoto(photo) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const request = tx.objectStore(STORE_NAME).put(photo);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      tx.onerror = () => reject(tx.error);
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

  // ---------------------------------------------------------------------------
  // Utilidades
  // ---------------------------------------------------------------------------

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

  function makeUploadId() {
    if (window.crypto && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function makeBoundary() {
    return `camtodrive_${makeUploadId().replaceAll("-", "")}`;
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
    elements.captureButton.disabled =
      state.captureInProgress || state.camera.starting || state.preview.open;
    elements.captureButton.classList.toggle("paused", state.camera.suspended);
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
    if (state.camera.suspended) {
      return "La camara se apago para ahorrar bateria. Toca la pantalla para reanudarla.";
    }
    if (authenticated) {
      return "Espera el recuadro verde y dispara: revisas la foto antes de subirla.";
    }
    if (state.pendingCount > 0) {
      return "Conecta Google para subir pendientes.";
    }
    return "Conecta Google y dispara: el recuadro verde avisa cuando hay foco.";
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
