# Resumen de implementacion

CamToDrive sigue siendo una web app estatica sin backend, frameworks ni build step, lista para publicar en GitHub Pages con rutas relativas.

## Encargo 5 - camara continua + arreglos de la revision

### Camara que no se cierra

- Vuelve el visor continuo con `getUserMedia` (`facingMode: environment`): se dispara las veces que haga falta sin que la camara se cierre entre fotos.
- Antes de capturar nada, la app sube el track a la maxima resolucion que declare el dispositivo: lee `track.getCapabilities()` y aplica `applyConstraints({width, height})` con esos maximos. Verificado en Chrome: la camara pasa de la resolucion por defecto a 3840x2160.
- Ruta de captura por prioridad:
  1. `ImageCapture.takePhoto()` con la resolucion maxima de `getPhotoCapabilities()`. Entrega una foto del sensor sin pasar por canvas (Chrome/Android).
  2. Si no existe `ImageCapture` (Safari/iOS), dibuja el fotograma en canvas y codifica JPEG con `CAPTURE_QUALITY` (por defecto 1).
- `requestVideoFrameCallback` espera el siguiente fotograma pintado para no capturar uno viejo del buffer.
- La etiqueta bajo el visor muestra resolucion real, megapixeles y si la foto viene del sensor o de un fotograma recomprimido.
- El stream se libera al ocultar la app y se reabre al volver. Si el track termina solo, se muestra el panel de fallback.
- La camara nativa sigue disponible como fallback (`<input type="file" capture="environment">`), que es la unica ruta con calidad 100% original.

**Compromiso conocido y aceptado:** la captura desde el visor pierde calidad frente a la camara nativa del telefono (fotograma de video, sin HDR ni procesado fotografico). Es el precio de que la camara no se cierre.

### Arreglos de la revision del 2026-07-31

- **Memoria**: la cola ya no carga todos los blobs de golpe. `getPendingPhotoIds()` trae solo las claves y cada foto se lee justo antes de subirla; la referencia se suelta al terminar.
- **Reintento**: si una foto agota sus intentos, se programa un reintento automatico a los 45 s (antes solo se reintentaba al recuperar red o al volver a la app).
- **Archivos grandes**: multipart solo cubre hasta ~5 MB. Por encima de ese tamano se abre una sesion resumable (`uploadType=resumable`) y se sube con `PUT` reportando progreso igual que antes.
- **Duplicados**: cada foto lleva un `uploadId` propio persistido en IndexedDB y escrito en `appProperties.camtodriveId`. Antes de cada reintento se consulta si ese archivo ya llego a Drive, asi que una respuesta perdida no crea una copia.
- **Consentimiento**: tras el primer `consent` se guarda una marca y las reconexiones usan `prompt: ""`, sin repetir la pantalla completa de Google.
- **404 inutil**: el reintento con otra carpeta solo se ejecuta cuando la carpeta se resolvio por nombre. Con `FOLDER_ID` fijo ya no se resube el archivo entero para nada.
- **Service worker**: cache `camtodrive-shell-v5` y solo se cachean respuestas `ok` (antes podia quedar cacheado un 404).
- **Documentacion**: README actualizado al comportamiento real.

### Pendiente que NO es codigo

La carpeta de Drive esta compartida como "cualquiera con el enlace -> Editor" y su `FOLDER_ID` viaja en `config.js` dentro de un repo publico. Cualquiera que vea el repo puede abrir la carpeta y borrar las fotos. Hay que cambiar el compartido a personas concretas desde Google Drive; la app no necesita el enlace publico.

## Cambios de encargos anteriores

- Barra de progreso real por foto con `XMLHttpRequest` y `xhr.upload.onprogress`, mas una barra global de lote.
- Los nombres de archivo usan timestamp con milisegundos y extension derivada del MIME real: `AAAA-MM-DD_HH-MM-SS-mmm.ext`.
- Subida en segundo plano con cola IndexedDB, concurrencia limitada a 3 fotos y reintentos con backoff. Tomar otra foto no espera a que terminen las subidas.
- Se mantienen el boton `Conectar Google`, el scope `https://www.googleapis.com/auth/drive`, `CLIENT_ID`, `FOLDER_ID` y `FOLDER_NAME` de `config.js`.

## Archivos principales

- `index.html`: una pagina con visor continuo, panel de fallback nativo, contadores y lista de disparos recientes.
- `config.js`: `CLIENT_ID`, `FOLDER_NAME`, `FOLDER_ID`, `CAPTURE_IDEAL_WIDTH/HEIGHT` y `CAPTURE_QUALITY`.
- `app.js`: Google Identity Services, camara continua, captura, cola IndexedDB, subida multipart/resumable, concurrencia, reintentos y reconexion.
- `styles.css`: interfaz mobile-first con visor, estados de cola y modo claro/oscuro.
- `manifest.webmanifest`: manifest PWA con scope/start URL relativos.
- `service-worker.js`: cache del shell estatico version v5.
- `icons/`: iconos SVG y PNG para PWA y `apple-touch-icon`.

## Pendiente para el usuario

La app asume que Google Drive API esta habilitada, que el OAuth Client ID de `config.js` esta autorizado para la URL de GitHub Pages y que los usuarios que suben fotos tienen permiso de escritura sobre la carpeta fija `FOLDER_ID`.
