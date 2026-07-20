# CamToDrive

CamToDrive es una web app estatica, sin backend y sin build step, pensada para Safari en iPhone. Abre la camara nativa trasera con `<input type="file" accept="image/*" capture="environment">`, toma la foto a calidad completa del flujo nativo de iOS y la sube a una carpeta dedicada de Google Drive usando Google Identity Services y Google Drive API v3.

## Archivos principales

- `index.html`: estructura de la app, meta tags PWA/iOS y carga de GIS.
- `config.js`: `CLIENT_ID` y `FOLDER_NAME` configurables.
- `app.js`: autenticacion OAuth, captura, subida multipart a Drive, carpeta y cola offline con IndexedDB.
- `styles.css`: UI mobile-first con modo claro/oscuro automatico.
- `manifest.webmanifest`: instalacion PWA.
- `service-worker.js`: cache del shell estatico para abrir la app offline.
- `icons/`: iconos SVG y PNG para PWA/iOS.

## 1. Crear el proyecto en Google Cloud Console

1. Abre Google Cloud Console: https://console.cloud.google.com/
2. Crea un proyecto nuevo desde el selector de proyectos.
3. Entra al proyecto creado.
4. Ve a **APIs & Services** > **Library**.
5. Busca **Google Drive API**.
6. Abre el resultado **Google Drive API** y pulsa **Enable**.

## 2. Configurar pantalla de consentimiento OAuth

1. Ve a **APIs & Services** > **OAuth consent screen**.
2. Elige el tipo de usuario que corresponda. Para uso personal normalmente sera **External**.
3. Completa los datos basicos requeridos de la app.
4. Deja la app en modo **Testing** mientras la usas tu o un grupo pequeno.
5. En **Scopes**, agrega exactamente este scope:

```text
https://www.googleapis.com/auth/drive.file
```

6. En **Test users**, agrega el email de Google con el que usaras CamToDrive.
7. Guarda los cambios.

El scope `drive.file` permite a la app crear archivos y acceder a archivos/carpetas creados o concedidos a esta app. Por eso CamToDrive crea una carpeta propia si no puede ver una carpeta previa con el mismo nombre.

## 3. Crear el OAuth Client ID

1. Ve a **APIs & Services** > **Credentials**.
2. Pulsa **Create credentials** > **OAuth client ID**.
3. En **Application type**, elige **Web application**.
4. Ponle un nombre, por ejemplo `CamToDrive GitHub Pages`.
5. En **Authorized JavaScript origins**, agrega la URL base de tu GitHub Pages. Ejemplos:

```text
https://TU_USUARIO.github.io
https://TU_USUARIO.github.io/TU_REPOSITORIO
```

Para repositorios de proyecto normalmente usa la URL completa con subpath, por ejemplo:

```text
https://aronr.github.io/CamToDrive
```

6. No necesitas configurar redirect URI para este flujo con Google Identity Services token client.
7. Pulsa **Create**.
8. Copia el **Client ID**, que termina en `.apps.googleusercontent.com`.

## 4. Poner el CLIENT_ID en `config.js`

Abre `config.js` y reemplaza:

```js
const CLIENT_ID = "TODO_PON_TU_CLIENT_ID.apps.googleusercontent.com";
```

por el Client ID real:

```js
const CLIENT_ID = "TU_CLIENT_ID_REAL.apps.googleusercontent.com";
```

Puedes cambiar tambien el nombre de carpeta si quieres:

```js
const FOLDER_NAME = "Fotos App";
```

## 5. Publicar en GitHub Pages

1. Crea un repositorio en GitHub.
2. Sube estos archivos a la rama principal del repositorio.
3. En GitHub, entra al repositorio.
4. Ve a **Settings** > **Pages**.
5. En **Build and deployment**, elige **Deploy from a branch**.
6. Selecciona la rama `main` o `master` y la carpeta `/root`.
7. Guarda.
8. Espera a que GitHub Pages publique la URL.
9. Vuelve a Google Cloud Console y confirma que esa URL exacta este en **Authorized JavaScript origins**.

La app usa rutas relativas (`./`), asi que funciona bajo subpath de GitHub Pages.

## 6. Agregar CamToDrive a la pantalla de inicio del iPhone

1. Abre la URL de GitHub Pages en Safari del iPhone.
2. Toca el boton **Compartir**.
3. Toca **Agregar a inicio**.
4. Confirma el nombre **CamToDrive**.
5. Abre CamToDrive desde el icono instalado.
6. Toca **Conectar Google** e inicia sesion con el email agregado como test user.
7. Toca **Tomar foto** para abrir la camara nativa trasera.

## Funcionamiento offline

- El service worker cachea el shell estatico, por lo que la app puede abrir aunque no haya red.
- La subida a Google Drive requiere conexion.
- Si una subida falla por red, la foto queda guardada como blob en IndexedDB.
- La app reintenta los pendientes al volver el evento `online` y al abrir/volver a la app con Google conectado.
- El contador de pendientes muestra cuantas fotos quedan por subir.

## Notas de seguridad y privacidad

- No hay backend: las fotos no pasan por servidores propios.
- El token OAuth vive solo en memoria del navegador y expira alrededor de una hora despues.
- Si Google devuelve 401 o el token expira, vuelve a aparecer **Conectar Google**.
- La app usa solo el scope obligatorio `https://www.googleapis.com/auth/drive.file`.
