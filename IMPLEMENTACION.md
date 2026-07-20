# Resumen de implementacion

CamToDrive sigue siendo una web app estatica sin backend, frameworks ni build step, lista para publicar en GitHub Pages con rutas relativas.

## Encargo 4 - auditor, debugger, limpiador y progreso

### Fase 1 - Auditor

- Confirmado: la subida multipart usaba `fetch`, por lo que no podia reportar progreso real de subida.
- Confirmado: la miniatura revocaba el `objectURL` al reemplazar la foto, pero no al salir de la pagina.
- Confirmado: los pendientes antiguos que arrancaban desde IndexedDB podian subir sin aparecer en "disparos recientes".
- Confirmado: los estados recientes solo distinguian `Subiendo`, sin porcentaje accesible por foto.
- Confirmado: el service worker seguia en cache v3 y debia pasar a v4 para refrescar el shell.
- Sin hallazgos prohibidos: no se encontro captura embebida, recomposicion ni recodificacion en `app.js`.

### Fase 2 - Debugger

- Se revoca la URL temporal de la ultima miniatura en `pagehide` y antes de crear otra.
- La cola ahora asegura una fila visible para cada foto que empieza a subir, incluso si viene de IndexedDB.
- El HTTP 401 de la subida XHR limpia la sesion y lanza `AuthExpiredError`, igual que la ruta autorizada existente.

### Fase 3 - Limpiador

- Se unifico la actualizacion de disparos recientes para aceptar parches de estado/progreso.
- Se centralizo el calculo y saneamiento de porcentajes para evitar valores fuera de rango.
- Se mantuvieron los textos y flujo de captura nativa sin agregar frameworks ni build.

### Fase 4 - Barra de progreso

- La subida multipart/related a Drive ahora usa `XMLHttpRequest`.
- `xhr.upload` reporta `progress` por foto y actualiza una barra accesible en la lista de disparos recientes.
- Se agrego una barra global de lote para las subidas activas.
- La captura sigue sin bloquearse: la foto original se encola al instante y las subidas continuan en segundo plano con concurrencia 3 y backoff.
- El service worker usa `camtodrive-shell-v4`.

## Cambios de encargos anteriores

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
