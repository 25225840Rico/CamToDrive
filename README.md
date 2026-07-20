# CamToDrive

CamToDrive es una web app estatica, sin backend y sin build step, pensada para GitHub Pages y uso movil. Mantiene una camara continua en pagina con `getUserMedia`, permite disparar varias fotos sin cerrar la camara y sube cada captura en segundo plano a una carpeta fija de Google Drive definida por `FOLDER_ID` en `config.js`.

## Archivos principales

- `index.html`: estructura de la app, visor de camara continuo, fallback nativo, meta tags PWA/iOS y carga de GIS.
- `config.js`: `CLIENT_ID`, `FOLDER_ID` y `FOLDER_NAME` configurables.
- `app.js`: autenticacion OAuth, captura con `ImageCapture` o canvas, cola IndexedDB, subida multipart a Drive, concurrencia limitada y reintentos.
- `styles.css`: UI mobile-first con visor principal, botones grandes, contadores y estados visibles.
- `manifest.webmanifest`: instalacion PWA.
- `service-worker.js`: cache del shell estatico para abrir la app offline.
- `icons/`: iconos SVG y PNG para PWA/iOS.

## 1. Crear el proyecto en Google Cloud Console

1. Abre Google Cloud Console: https://console.cloud.google.com/
2. Crea o selecciona un proyecto.
3. Ve a **APIs & Services** > **Library**.
4. Busca **Google Drive API** y pulsa **Enable**.

## 2. Configurar pantalla de consentimiento OAuth

1. Ve a **APIs & Services** > **OAuth consent screen**.
2. Completa los datos basicos de la app.
3. En **Scopes**, agrega exactamente este scope:

```text
https://www.googleapis.com/auth/drive
```

4. Si la app queda en modo **Testing**, agrega como test users todos los correos Google que usaran CamToDrive.
5. Guarda los cambios.

La app usa el scope Drive completo porque sube a una carpeta fija existente (`FOLDER_ID`) que puede pertenecer o estar compartida con distintos usuarios.

## 3. Crear el OAuth Client ID

1. Ve a **APIs & Services** > **Credentials**.
2. Pulsa **Create credentials** > **OAuth client ID**.
3. En **Application type**, elige **Web application**.
4. En **Authorized JavaScript origins**, agrega la URL base de GitHub Pages. Ejemplos:

```text
https://TU_USUARIO.github.io
https://TU_USUARIO.github.io/TU_REPOSITORIO
https://aronr.github.io/CamToDrive
```

5. No necesitas redirect URI para el token client de Google Identity Services.
6. Copia el Client ID terminado en `.apps.googleusercontent.com`.

## 4. Configurar `config.js`

Reemplaza `CLIENT_ID` por el OAuth Client ID real y deja `FOLDER_ID` con el ID de la carpeta existente donde se guardaran las fotos:

```js
const CLIENT_ID = "TU_CLIENT_ID_REAL.apps.googleusercontent.com";
const FOLDER_ID = "ID_DE_LA_CARPETA_DE_DRIVE";
```

Cada usuario autenticado debe tener permiso para crear archivos en esa carpeta.

## 5. Publicar en GitHub Pages

1. Sube estos archivos a la rama principal del repositorio.
2. En GitHub, entra a **Settings** > **Pages**.
3. Elige **Deploy from a branch** y selecciona `main` o `master` con carpeta `/root`.
4. Espera la URL publicada y verifica que esa URL este en **Authorized JavaScript origins**.

La app usa rutas relativas (`./`), asi que funciona bajo subpath de GitHub Pages.

## 6. Uso en iPhone o Android

1. Abre la URL HTTPS de GitHub Pages.
2. Acepta el permiso de camara cuando el navegador lo solicite.
3. Pulsa **Conectar Google** e inicia sesion con una cuenta autorizada.
4. Pulsa **Disparar** tantas veces como necesites; la camara sigue abierta.
5. Observa los contadores de pendientes/subiendo y el estado reciente de cada disparo.

Si `getUserMedia` falla o el permiso fue denegado, la app muestra **Reintentar** y **Usar camara nativa** como fallback con `capture="environment"`.

## Funcionamiento offline

- El service worker cachea el shell estatico.
- Cada foto se guarda primero en IndexedDB.
- La subida a Google Drive requiere conexion y token vigente.
- Si una subida falla, la foto queda pendiente y se reintenta con backoff al volver la red o al reconectar Google.
- La cola sube hasta 3 fotos en paralelo para vaciar pendientes sin bloquear la captura.

## Notas de seguridad y privacidad

- No hay backend: las fotos no pasan por servidores propios.
- El token OAuth vive solo en memoria del navegador y expira alrededor de una hora despues.
- Si Google devuelve 401 o el token expira, vuelve a aparecer **Conectar Google**.
- Al ocultar la app, el stream de camara se libera; al volver, se intenta abrir nuevamente.