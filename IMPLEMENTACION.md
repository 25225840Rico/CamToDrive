# Resumen de implementacion

CamToDrive sigue siendo una web app estatica sin backend, frameworks ni build step, lista para publicar en GitHub Pages con rutas relativas.

## Cambios de este encargo

- La captura vuelve a ser 100% nativa con `<input type="file" accept="image/*" capture="environment">` para abrir la camara trasera del sistema.
- Se elimino por completo la captura en pagina: no hay stream de camara, visor embebido, APIs de captura por frame, redimensionado, recomposicion ni parametros de calidad.
- El archivo que entrega la camara se trata como fuente unica de verdad: el `File` original se guarda directamente en IndexedDB y ese mismo blob se sube a Google Drive.
- No se recomprime, no se recodifica, no se cambia formato, no se eliminan metadatos y no se fuerza JPEG. Si el iPhone entrega HEIC, se sube HEIC; si entrega JPEG, se sube JPEG.
- Los nombres de archivo usan timestamp con milisegundos y extension derivada del MIME real: `AAAA-MM-DD_HH-MM-SS-mmm.ext`.
- La subida sigue en segundo plano con la cola existente, concurrencia limitada a 3 fotos y reintentos con backoff. Tomar otra foto no espera a que terminen las subidas.
- Tras recibir una foto, la app intenta reabrir la camara nativa como best-effort. Si el navegador lo bloquea, el boton `Disparar` queda listo para un toque inmediato.
- Se mantienen el boton `Conectar Google`, el scope `https://www.googleapis.com/auth/drive`, `CLIENT_ID`, `FOLDER_ID` y `FOLDER_NAME` de `config.js`.
- Se actualizaron los textos y estilos para reflejar captura nativa, no visor continuo.
- Se subio la version del cache del service worker a `camtodrive-shell-v3` para refrescar el shell estatico.

## Archivos principales

- `index.html`: estructura de una pagina con boton de disparo nativo, input file/capture, contadores y lista de disparos recientes.
- `config.js`: constantes `CLIENT_ID`, `FOLDER_ID` y `FOLDER_NAME` configurables.
- `app.js`: autenticacion con Google Identity Services, captura nativa por `File`, cola IndexedDB, subida multipart a Drive, concurrencia limitada, reintentos y reconexion.
- `styles.css`: interfaz mobile-first con accion de disparo grande, panel de captura nativa, estados de cola y modo claro/oscuro.
- `manifest.webmanifest`: manifest PWA con scope/start URL relativos.
- `service-worker.js`: cache del shell estatico version v3.
- `icons/`: iconos SVG y PNG para PWA y `apple-touch-icon`.

## Pendiente para el usuario

La app asume que Google Drive API esta habilitada, que el OAuth Client ID de `config.js` esta autorizado para la URL de GitHub Pages y que los usuarios que suben fotos tienen permiso de escritura sobre la carpeta fija `FOLDER_ID`.