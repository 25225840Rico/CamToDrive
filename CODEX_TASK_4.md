# Encargo 4 — CamToDrive: auditar + debuguear + limpiar + BARRA DE PROGRESO

Trabaja sobre el proyecto existente. Actua en fases, como un equipo de subagentes que se
revisan entre si: (1) AUDITOR, (2) DEBUGGER, (3) LIMPIADOR, (4) FEATURE barra de progreso.
No rompas lo que funciona. Al final deja resumen por fase en IMPLEMENTACION.md.

## REGLAS INVIOLABLES (no las toques)
- CALIDAD NATIVA: la foto que se sube es el File ORIGINAL de la camara, byte por byte. NO
  reintroducir getUserMedia, <video>, canvas, ImageCapture, toBlob, drawImage ni recompresion.
- NO cambiar CLIENT_ID, FOLDER_ID ni FOLDER_NAME en config.js.
- NO cambiar el scope (https://www.googleapis.com/auth/drive).
- NO levantar servidores locales (nada de :8000). Validar solo con `node --check`.
- Sin frameworks ni build. Rutas relativas. PWA + service worker (sube cache a v4).
  Comentarios en espanol.

## Fase 1 - AUDITOR
Revisa app.js, index.html, styles.css, service-worker.js buscando bugs reales, casos borde,
fugas de memoria (objectURL sin revocar), condiciones de carrera en la cola, manejo de
errores silenciosos, y accesibilidad basica. Lista los hallazgos en IMPLEMENTACION.md.

## Fase 2 - DEBUGGER
Corrige los bugs confirmados de la fase 1. Cada fix minimo y verificado. No cambies
comportamiento correcto.

## Fase 3 - LIMPIADOR
Simplifica y ordena: elimina codigo muerto/estado sin uso que haya quedado de versiones
anteriores (p.ej. restos de la camara en pagina si quedan), unifica helpers duplicados,
nombres claros, consistencia de estados/mensajes. Sin cambiar la funcionalidad.

## Fase 4 - BARRA DE PROGRESO de subida (feature nuevo)
Muestra el progreso REAL de cada subida.
NOTA TECNICA OBLIGATORIA: fetch() NO reporta progreso de subida. Cambia la subida multipart
a XMLHttpRequest y usa xhr.upload.addEventListener("progress", ...) para obtener
loaded/total y calcular el porcentaje. Mantén el manejo actual: enviar el mismo cuerpo
multipart/related, el header Authorization Bearer, y tratar HTTP 401 como AuthExpiredError
(igual que authorizedFetch). Reintentos/backoff y concurrencia deben seguir funcionando.
UI:
- Una barra de progreso por cada foto que se este subiendo (idealmente en la lista de
  "disparos recientes"), que avance de 0% a 100% segun el progreso real del XHR.
- Además/opcional: una barra global que refleje el avance del lote en curso.
- Estados claros: en cola -> subiendo (con %) -> OK / pendiente(error). Accesible
  (role/aria-valuenow si aplica). Estilos coherentes con el resto del CSS.
- La barra NO debe bloquear el disparo (la captura sigue siendo instantanea).

## Cierre
Valida `node --check app.js`, `node --check config.js`, `node --check service-worker.js`.
Verifica que NO haya getUserMedia/canvas/toBlob en app.js y que la subida use XMLHttpRequest
con evento de progreso. Actualiza IMPLEMENTACION.md con lo hecho por fase.
