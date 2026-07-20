# Encargo 2 (mejoras) — CamToDrive

Trabaja en el proyecto existente en este directorio (ya funciona y sube fotos a una
carpeta fija de Google Drive via FOLDER_ID en config.js, con scope
https://www.googleapis.com/auth/drive). NO rompas lo que ya sirve. Aplica estas mejoras
y optimiza el codigo en general (claridad, rendimiento, robustez), sin agregar frameworks
ni build step (sigue siendo web estatica para GitHub Pages, rutas relativas).

## Objetivo principal: camara CONTINUA + carga en 2do plano
Hoy usa <input type="file" capture="environment">, que abre la camara nativa y se CIERRA
tras cada foto. El usuario quiere seguir tomando fotos SIN que la camara se cierre, y que
la subida ocurra en segundo plano sin bloquear.

Implementa una camara EN PAGINA con getUserMedia:
- Visor de video en vivo a pantalla (facingMode: "environment", camara trasera).
- Pide la MAYOR resolucion posible: video constraints width/height ideal 4096x2160 (o el
  maximo que otorgue el dispositivo); usa track.getCapabilities()/applyConstraints para
  subir al maximo soportado. Donde exista ImageCapture.takePhoto(), usalo para mejor
  calidad; si no (iOS Safari), captura del <video> a <canvas> al tamano nativo del track y
  exporta a JPEG con calidad 0.95.
- Boton de disparo grande. Tras disparar, la camara SIGUE ABIERTA y lista para el
  siguiente disparo de inmediato (no navega, no recarga, no cierra el stream).
- Cada disparo se encola y se sube en 2do plano (reutiliza/mejora la cola IndexedDB +
  processPendingQueue existentes). El disparo debe ser instantaneo aunque haya subidas en
  curso (subidas en paralelo controladas o secuenciales sin bloquear la captura).
- Indicadores no bloqueantes: contador de "subiendo/pendientes", miniatura del ultimo
  disparo, y marca de exito por foto.
- Mantener boton "Conectar Google" y manejo de expiracion de token igual que hoy.
- Manejo de permisos: si el usuario niega la camara, mensaje claro y opcion de reintentar.
  Deja como FALLBACK opcional el input file nativo (capture) por si getUserMedia falla.
- iOS: el <video> necesita playsinline y muted para autoplay; el getUserMedia solo funciona
  en HTTPS (GitHub Pages ya es HTTPS). Recuerda soltar el stream al salir/visibilitychange
  oculto y re-adquirirlo al volver.

## Optimizacion general
- Revisa app.js: hoy varios mensajes de elements.authHint se sobrescriben por
  updateControls(); corrige esa incoherencia para que los mensajes de estado sean
  consistentes.
- Sube en paralelo con un limite (p.ej. 2-3 a la vez) para vaciar la cola mas rapido sin
  saturar; reintentos con backoff.
- Nombre de archivo por timestamp con milisegundos para evitar colisiones si se dispara
  muy rapido: AAAA-MM-DD_HH-MM-SS-mmm.jpg
- Multiusuario: la app la usaran varias personas (cada una con su propia cuenta Google,
  todas suben a la MISMA carpeta fija FOLDER_ID). No cambies FOLDER_ID ni el scope. Asegura
  que el flujo funcione identico para cualquier usuario autenticado.

## Requisitos que se mantienen
- Sin backend, sin frameworks, sin build. Rutas relativas. PWA + service worker.
- config.js sigue con CLIENT_ID, FOLDER_ID, FOLDER_NAME.
- Codigo comentado en espanol donde ayude.

Cuando termines, valida con node --check y actualiza IMPLEMENTACION.md con lo que cambiaste.
