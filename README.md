# CamToDrive

CamToDrive es una web app estatica, sin backend y sin build step, pensada para GitHub Pages y uso movil. Mantiene una camara continua en pagina con `getUserMedia`, permite disparar varias fotos sin cerrar la camara y sube cada captura en segundo plano a una carpeta fija de Google Drive definida por `FOLDER_ID` en `config.js`.

## Calidad de imagen: lee esto primero

La camara continua **no** entrega la misma calidad que la camara nativa del telefono. Captura un fotograma del stream de video, sin HDR ni el procesado fotografico del sistema. La app hace todo lo posible por acercarse:

- Pide la maxima resolucion que declare el dispositivo (`track.getCapabilities()` + `applyConstraints`).
- Usa `ImageCapture.takePhoto()` cuando existe (Chrome/Android): esa ruta entrega una foto del sensor sin pasar por canvas.
- Cuando no existe (Safari/iOS) dibuja el fotograma en canvas y codifica JPEG con `CAPTURE_QUALITY` (por defecto 1, el maximo).
- La etiqueta bajo el visor muestra en todo momento la resolucion real y si la foto viene del sensor o de un fotograma recomprimido.

Si en algun momento quieres calidad 100% nativa (archivo original del telefono, HEIC incluido), esta el fallback de camara nativa: aparece cuando `getUserMedia` falla y usa `<input type="file" capture="environment">`, que sube el `File` tal cual, sin recomprimir.

## Archivos principales

- `index.html`: estructura de la app. El visor ocupa la pantalla entera (`.stage`) y los controles flotan encima en una capa aparte (`.hud`); ademas, panel de fallback nativo, meta tags PWA/iOS y carga de GIS.
- `config.js`: `CLIENT_ID`, `ALLOWED_EMAILS`, `FOLDER_ID`, `FOLDER_EXPECTED_NAME`, resolucion ideal y calidad de captura.
- `app.js`: autenticacion OAuth, camara continua, captura con `ImageCapture` o canvas, cola IndexedDB, subida multipart/resumable a Drive, concurrencia limitada y reintentos.
- `styles.css`: UI mobile-first sin marcos: la imagen es el fondo y los controles son vidrio flotante (Liquid Glass). Cada capa del material traduce una ley optica: Fresnel en los cantos, reflejo especular Blinn-Phong arriba-izquierda, absorcion Beer-Lambert en el tinte y dispersion de Cauchy en las franjas de color. El unico marco dibujado es el de foco, que abarca el encuadre util y se pinta con cantoneras enmascaradas.
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
const ALLOWED_EMAILS = ["tucorreo@gmail.com"];
const FOLDER_ID = "ID_DE_LA_CARPETA_DE_DRIVE";
const FOLDER_EXPECTED_NAME = "NOMBRE DE ESA CARPETA";
```

### Las dos puertas: quien sube y adonde

En Drive el espacio de un archivo lo paga **quien lo sube**, no el dueno de la carpeta. Por eso hacen falta dos comprobaciones distintas, y ninguna implica la otra:

1. **Quien sube** — `ALLOWED_EMAILS`. Al conectar, la app pregunta a Drive de quien es el token y bloquea la subida si no esta en la lista. Sin esto, el navegador puede entregar un token de otra sesion activa sin mostrar ninguna pantalla, y las fotos quedan en el Drive de esa persona aunque caigan en la carpeta correcta. Paso el 31 de julio de 2026.
2. **Adonde** — `FOLDER_ID` + `FOLDER_EXPECTED_NAME`. La app comprueba contra Drive que ese ID existe, es una carpeta, no esta en la papelera, **te pertenece** y admite archivos. Si la carpeta fuera de otra cuenta, no sube nada. El nombre solo avisa por consola: atrapa un ID mal pegado, que casi nunca apunta a "nada" sino a otra carpeta real.

**No hay carpeta de respaldo.** Sin `FOLDER_ID` la app no conecta ni sube. La version anterior creaba una carpeta por nombre cuando faltaba el ID, y la creaba en el Drive de la cuenta conectada: un destino que dependia de la sesion del navegador.

Si vas a compartir la carpeta con otra persona, ten claro que **cada foto que suba ella ocupara SU espacio de Drive, no el tuyo** — aunque viva en tu carpeta. Si no quieres eso, no la agregues a `ALLOWED_EMAILS` y quitale el acceso a la carpeta en Drive.

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

Si `getUserMedia` falla o el permiso fue denegado, la app muestra **Reintentar camara** y **Usar camara nativa** como fallback con `capture="environment"`.

## Funcionamiento offline

- El service worker cachea el shell estatico (solo respuestas correctas).
- Cada foto se guarda primero en IndexedDB.
- La subida a Google Drive requiere conexion y token vigente.
- Si una subida falla, la foto queda pendiente y se reintenta con backoff, al volver la red, al reconectar Google o pasados 45 segundos.
- La cola sube hasta 3 fotos en paralelo para vaciar pendientes sin bloquear la captura.
- Los blobs se leen de IndexedDB de uno en uno, asi que una cola larga no llena la memoria del telefono.
- Archivos de hasta 5 MB van por subida multipart; por encima se usa una sesion resumable de Drive.
- Cada foto lleva un identificador propio en `appProperties`, asi que un reintento nunca crea un duplicado en Drive.

## A que cuenta van las fotos: lee esto antes de tocar `config.js`

En Google Drive **el propietario de un archivo es siempre quien lo sube**, no el dueño de la
carpeta que lo contiene. Un archivo puede estar dentro de tu carpeta, verse en tu Drive, y aun
asi pertenecer a otra persona y consumir *su* cuota de 15 GB.

Eso hace que baste con que el navegador tenga la sesion de otra cuenta activa para que las
fotos terminen en el Drive equivocado. **Ya ocurrio:** el 31 de julio de 2026 un lote de fotos
quedo a nombre de otra cuenta sin que la app diera el menor aviso, porque la interfaz se veia
identica estuviera quien estuviera conectado.

La app se defiende con tres medidas, y conviene no desarmarlas:

1. **`ALLOWED_EMAILS` en `config.js`.** Tras recibir el token, la app pregunta a Drive de quien
   es (`drive/v3/about?fields=user`) **antes de subir nada**. Si el correo no esta en la lista,
   rechaza el token y bloquea la subida. Con la lista vacia (`[]`) aceptas cualquier cuenta.
2. **El correo conectado se muestra siempre** en el chip superior del visor: verde si esta
   autorizado, rojo si fue rechazado. Tocarlo abre el selector de cuentas de Google. Un fallo
   que no se ve es un fallo que se repite.
3. **Cada foto en la cola recuerda con que cuenta se tomo.** Una foto nunca se sube con una
   cuenta distinta a la suya, ni siquiera si el token expira y reconectas con otra.

Ademas, cada archivo subido queda marcado en Drive con `appProperties.camtodriveOwner`, asi que
siempre se puede auditar despues con que cuenta se subio.

### Si unas fotos quedaron en el Drive equivocado

No hace falta moverlas ni volver a subirlas: ya estan en la carpeta correcta. Basta con abrir
la carpeta en Drive, seleccionar los archivos, y usar **Transferir propiedad** hacia la cuenta
que corresponde. Ordena por la columna *Propietario* para verlos agrupados.

## Notas de seguridad y privacidad

- No hay backend: las fotos no pasan por servidores propios.
- El token OAuth vive solo en memoria del navegador y expira alrededor de una hora despues.
- Si Google devuelve 401 o el token expira, vuelve a aparecer **Conectar Google**.
- Al ocultar la app, el stream de camara se libera; al volver, se intenta abrir nuevamente.
- La carpeta destino no deberia estar compartida como "cualquiera con el enlace": el `FOLDER_ID` viaja en `config.js`, que es publico. Comparte la carpeta solo con las cuentas que suben fotos.
