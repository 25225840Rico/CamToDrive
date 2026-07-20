# Resumen de implementacion

CamToDrive sigue siendo una web app estatica sin backend, frameworks ni build step, lista para publicar en GitHub Pages con rutas relativas.

## Cambios de este encargo

- Se reemplazo el flujo principal de `<input type="file" capture>` por una camara continua en pagina con `getUserMedia`, video `playsinline`/`muted` para iOS y preferencia por camara trasera.
- La app pide 4096x2160 como resolucion ideal y, cuando el navegador expone capacidades del track, intenta aplicar la resolucion maxima soportada.
- La captura usa `ImageCapture.takePhoto()` cuando esta disponible. Si falla o no existe, usa el frame nativo del video en canvas y exporta JPEG con calidad 0.95.
- Cada disparo se guarda primero en IndexedDB y la subida a Drive se procesa en segundo plano, por lo que la camara queda abierta para seguir disparando.
- La cola de pendientes ahora sube con concurrencia limitada a 3 fotos y reintentos con backoff antes de dejar la foto pendiente.
- Se agregaron indicadores de pendientes, subidas activas, miniatura de la ultima foto y estado de los disparos recientes (`En cola`, `Subiendo`, `OK`, `Pendiente`).
- Se mantiene el boton `Conectar Google`, el scope `https://www.googleapis.com/auth/drive`, `FOLDER_ID` fijo de `config.js` y el manejo de expiracion/reconexion del token.
- Si la camara en pagina falla o el permiso es denegado, la UI muestra un mensaje claro, boton de reintento y fallback al input nativo con `capture="environment"`.
- Al ocultar la app se libera el stream de camara; al volver visible se intenta adquirir de nuevo y se reanuda el procesamiento de cola si hay Google conectado.
- Se corrigio la incoherencia de `authHint`: `updateControls()` ya no pisa mensajes especificos de estado y usa un hint por defecto solo cuando no hay uno explicito.
- Los nombres de archivo ahora incluyen milisegundos: `AAAA-MM-DD_HH-MM-SS-mmm.jpg`.
- Se actualizo la version del cache del service worker para refrescar el shell estatico.

## Archivos principales

- `index.html`: estructura de una pagina con visor de camara continuo, botones de conexion/captura, fallback nativo, contadores y lista de disparos recientes.
- `config.js`: constantes `CLIENT_ID`, `FOLDER_ID` y `FOLDER_NAME` configurables.
- `app.js`: autenticacion con Google Identity Services, captura continua, cola IndexedDB, subida multipart a Drive, concurrencia limitada, reintentos y control de permisos/ciclo de vida de camara.
- `styles.css`: interfaz mobile-first con visor principal, botones grandes, estados de cola y modo claro/oscuro.
- `manifest.webmanifest`: manifest PWA con scope/start URL relativos.
- `service-worker.js`: cache del shell estatico con version actualizada.
- `icons/`: iconos SVG y PNG para PWA y `apple-touch-icon`.

## Pendiente para el usuario

La app asume que Google Drive API esta habilitada, que el OAuth Client ID de `config.js` esta autorizado para la URL de GitHub Pages y que los usuarios que suben fotos tienen permiso de escritura sobre la carpeta fija `FOLDER_ID`.
