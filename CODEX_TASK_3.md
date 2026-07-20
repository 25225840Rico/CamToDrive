# Encargo 3 (CRITICO - CALIDAD NATIVA) — CamToDrive

Trabaja sobre el proyecto existente. Objetivo NO NEGOCIABLE: las fotos deben subirse con
CALIDAD NATIVA COMPLETA del iPhone, SIN ninguna perdida. El usuario fue enfatico. Se
estricto y no tomes atajos.

## REGLA DE ORO (obligatoria)
La foto que se sube a Drive debe ser EXACTAMENTE el archivo original que entrega la camara
del sistema, byte por byte. PROHIBIDO:
- PROHIBIDO usar getUserMedia / <video> / canvas / ctx.drawImage / canvas.toBlob para la
  captura que se sube.
- PROHIBIDO re-codificar, recomprimir, redimensionar o cambiar el formato/calidad.
- PROHIBIDO pasar cualquier parametro de calidad (nada de 0.95, etc.).
- PROHIBIDO quitar EXIF o metadatos.
El File del input se guarda en IndexedDB y se sube TAL CUAL (su Blob original, su mimeType
original). Si el iPhone entrega HEIC, se sube HEIC; si entrega JPEG, se sube JPEG.

## Captura (metodo PRINCIPAL y unico de calidad)
- Usar <input type="file" accept="image/*" capture="environment"> (camara nativa trasera).
- El archivo devuelto (event.target.files[0]) es el original: encolarlo directo, sin tocar.
- QUITAR del flujo la camara en pagina (getUserMedia): eliminar el <video>, el visor en
  vivo, ImageCapture, maximizeTrackResolution, captureVideoFrameAsJpeg y todo lo asociado.
  La app vuelve a ser de calidad nativa.
- Nombre de archivo: timestamp AAAA-MM-DD_HH-MM-SS-mmm + la EXTENSION CORRECTA segun el
  mimeType real del archivo (image/jpeg->.jpg, image/heic->.heic, image/png->.png, etc.).

## Disparo rapido "casi continuo" (sin sacrificar calidad)
En iOS la camara nativa se cierra tras cada foto; es inevitable si se quiere calidad nativa.
Minimiza la friccion:
- Boton de disparo grande y, tras volver una foto, que quede listo al instante para la
  siguiente (un solo toque). La subida ocurre en 2do plano y NUNCA bloquea el disparo.
- Intenta reabrir el input automaticamente tras cada captura como best-effort (por si iOS lo
  permite dentro del gesto); si el navegador lo bloquea, el boton de un toque basta. No rompas
  nada si el auto-reabrir falla.

## Mantener (NO romper)
- La cola en 2do plano con concurrencia y reintentos/backoff que ya existe: consérvala y
  úsala para subir los originales.
- config.js: NO cambiar CLIENT_ID, FOLDER_ID ni FOLDER_NAME.
- app.js: NO cambiar el scope (queda https://www.googleapis.com/auth/drive).
- PWA + service worker (sube el cache a v3 porque cambia el shell). Rutas relativas. Sin
  frameworks ni build. Comentarios en espanol.

## Prohibiciones operativas
- NO levantes ningun servidor local (nada de python -m http.server / :8000). Solo valida con
  `node --check app.js`, `node --check config.js`, `node --check service-worker.js`.
- Actualiza IMPLEMENTACION.md explicando que ahora la captura es 100% nativa sin recompresion.

Verifica al final que en app.js NO exista getUserMedia ni canvas.toBlob, y que el blob
subido sea el File original.
