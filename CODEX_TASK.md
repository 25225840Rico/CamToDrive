# Encargo: "CamToDrive" — web app estática que sube fotos de la cámara nativa del iPhone directo a Google Drive

Eres el implementador. Construye el proyecto COMPLETO descrito aquí, en este mismo directorio de trabajo. No pidas confirmación: crea todos los archivos y déjalo listo para desplegar en GitHub Pages.

## Objetivo
Una web app de una sola página, 100% cliente (sin backend), alojable en GitHub Pages. Se abre en Safari del iPhone, se agrega a la pantalla de inicio como PWA, y permite:
1. Tocar un botón grande → abre la **cámara nativa trasera de iOS** (calidad completa del sensor).
2. Tras disparar, la foto se **sube automáticamente a una carpeta dedicada de Google Drive** del usuario.
3. La foto va directa a Drive (no se guarda en el carrete cuando se usa este flujo web).

## Requisitos técnicos (obligatorios)

### Captura de cámara
- Usar `<input type="file" accept="image/*" capture="environment">` para invocar la cámara nativa trasera. NO usar `getUserMedia` (reduce la calidad en iOS).
- Debe permitir tomar una foto tras otra sin recargar.

### Autenticación Google (cliente puro)
- Usar **Google Identity Services** (GIS), token client OAuth desde el navegador. Cargar el script `https://accounts.google.com/gsi/client`.
- Scope EXACTO: `https://www.googleapis.com/auth/drive.file` (solo archivos creados por la app; evita verificación de Google).
- El `CLIENT_ID` de OAuth debe ser una **constante claramente marcada al inicio de un archivo `config.js`** con un placeholder `TODO_PON_TU_CLIENT_ID.apps.googleusercontent.com` y un comentario explicando de dónde sacarlo.
- Manejar caducidad del token (~1h): botón "Conectar Google" que reaparece si el token expira o falla con 401.

### Subida a Drive
- API REST de Google Drive v3, upload **multipart** (`https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`).
- Al primer uso, crear (o reutilizar si ya existe) una carpeta llamada por defecto **`Fotos App`** en la raíz del Drive; nombre configurable en `config.js` (`FOLDER_NAME`). Guardar el folderId encontrado/creado en `localStorage` para no recrearla.
- Nombre de archivo por marca de tiempo local: `AAAA-MM-DD_HH-MM-SS.jpg`.
- Subir con el `parents` apuntando a esa carpeta.

### Robustez / cola offline
- Si una subida falla (sin señal / error de red), encolar la foto (guardar el blob en IndexedDB) y reintentar automáticamente cuando vuelva la conexión (`online` event) y al abrir la app.
- Mostrar contador de "pendientes por subir".

### UX (mobile-first)
- Diseño limpio, botones grandes tipo app, pensado para una mano. Modo claro y oscuro según el sistema.
- Estados visibles: "Conectar Google", "Tomar foto", "Subiendo…", "✓ Subida OK", "⚠ En cola (N pendientes)".
- Miniatura de la última foto tomada.
- Nada de librerías externas de UI: HTML + CSS + JS vanilla. Sin build step.

### PWA
- `manifest.webmanifest` (nombre "CamToDrive", display standalone, íconos) y un `service-worker.js` que cachee el shell estático para poder abrir la app offline (la subida requiere red, pero el shell debe cargar). Incluir íconos PWA (puedes generarlos como SVG/PNG simples embebidos o archivos generados).
- Meta viewport y apple-touch-icon para "Agregar a inicio" en iOS.

## Entregables (archivos)
- `index.html`
- `config.js` (CLIENT_ID + FOLDER_NAME, con placeholders y comentarios)
- `app.js` (lógica: auth, cámara, subida, cola IndexedDB)
- `styles.css`
- `manifest.webmanifest`
- `service-worker.js`
- íconos PWA (`icons/`)
- `README.md` con: (a) pasos EXACTOS para crear el proyecto en Google Cloud Console (crear proyecto, habilitar Google Drive API, crear credenciales OAuth Client ID tipo "Web application", agregar la URL de GitHub Pages en "Authorized JavaScript origins", agregar el email del usuario como test user en la pantalla de consentimiento OAuth en modo Testing con scope drive.file); (b) cómo poner el CLIENT_ID en config.js; (c) cómo publicar en GitHub Pages; (d) cómo agregarla a la pantalla de inicio del iPhone.
- `.gitignore` adecuado.

## Restricciones
- Sin backend, sin frameworks, sin paso de compilación. Todo debe funcionar sirviendo los archivos estáticos tal cual.
- Código comentado en español donde ayude.
- Debe funcionar servido bajo un subpath de GitHub Pages (rutas relativas, no absolutas desde `/`). El service worker debe registrarse con scope relativo.

Cuando termines, deja un resumen breve en un archivo `IMPLEMENTACION.md` con lo que hiciste y qué le falta hacer al usuario (el paso de Google Cloud).
