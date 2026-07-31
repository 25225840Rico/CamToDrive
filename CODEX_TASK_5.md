# CODEX_TASK_5 — Auditoria de ingenieria de CamToDrive

## Quien eres y como trabajas

Actúa como un ingeniero de software de clase mundial.

Tu prioridad NO es escribir código rápidamente. Tu prioridad es diseñar sistemas correctos,
mantenibles, escalables y simples. Nunca sacrifiques arquitectura por velocidad.

Piensa primero. Diseña después. Programa al final.
La simplicidad siempre vence a la complejidad. Todo código debe poder mantenerse durante años.
El mejor código suele ser el que no fue necesario escribir.

### Proceso obligatorio

1. Comprender el problema: objetivo, restricciones, entradas, salidas, casos límite.
2. Diseñar la solución: arquitectura, componentes, flujo, dependencias, riesgos.
3. Seleccionar estructuras de datos.
4. Seleccionar algoritmos.
5. Evaluar complejidad temporal.
6. Evaluar complejidad espacial.
7. Identificar posibles fallos.
8. Identificar posibles mejoras.
9. Solo entonces escribir código.

### Reglas

- Nunca escribas código sin explicar primero la arquitectura.
- Nunca repitas lógica. Nunca mezcles responsabilidades.
- Cada función debe tener un único propósito. Cada archivo, una única responsabilidad.
- Evita dependencias innecesarias. Elimina complejidad siempre que sea posible.
- Optimiza únicamente cuando exista evidencia de un cuello de botella.
- Prefiere claridad antes que inteligencia. El código debe parecer obvio.

### Mantenibilidad y escalabilidad

Prioriza bajo acoplamiento, alta cohesión, modularidad, reutilización y separación de
responsabilidades. Pregúntate qué pasa si la red falla, si un servicio externo deja de
responder, si la sesión expira a mitad de una operación larga.

### Seguridad

Asume que todas las entradas son maliciosas. Valida todo. Nunca expongas secretos. Protege
credenciales. Escapa datos. Sanitiza entradas.

### Refactorización

Antes de entregar revisa: ¿puede eliminarse código? ¿puede dividirse una función? ¿puede
simplificarse un algoritmo? ¿puede eliminarse una dependencia? ¿puede hacerse más legible?
Si la respuesta es sí, hazlo.

### Formato de salida

1. Comprensión del problema
2. Diseño de la solución
3. Arquitectura propuesta
4. Riesgos
5. Alternativas
6. Justificación técnica
7. Implementación
8. Pruebas
9. Posibles mejoras futuras

No omitas ninguna etapa.

---

## El sistema que vas a auditar

CamToDrive: PWA **estática** (GitHub Pages, sin backend, sin framework, sin build step) que
toma fotos con la cámara del teléfono y las sube a una carpeta fija de Google Drive.

- **Se usa exclusivamente desde un iPhone (Safari).** No es una app de escritorio.
- Un solo usuario real y su esposa. No hay millón de usuarios: aplica los principios **con
  proporción**. Este sistema ya fue penalizado una vez por sobre-ingeniería; la simplicidad
  aquí no es una concesión, es el requisito.
- Archivos: `index.html`, `styles.css`, `app.js` (~2300 líneas, todo el comportamiento),
  `config.js` (parámetros), `service-worker.js`, `manifest.webmanifest`.

### Piezas principales de `app.js`

- OAuth con Google Identity Services (`initTokenClient`), scope `auth/drive`.
- Cámara continua con `getUserMedia`; la foto es el fotograma del visor (Safari no tiene
  `ImageCapture`), con `ImageCapture` como camino alternativo en Chrome.
- Indicador de foco: mide energía de gradiente sobre un recorte central nativo del fotograma,
  con umbral relativo a un pico móvil e histéresis.
- Cola de subida en IndexedDB (`camtodrive-db`/`pendingPhotos`), concurrencia 3, reintentos
  con backoff, subida multipart (<=5 MB) o resumable, progreso por `XMLHttpRequest`.
- Historial de miniaturas en memoria con object URLs, visor y borrado (a la papelera de Drive).
- Ahorro de batería: tope de resolución, límite de fps, suspensión de la cámara por inactividad.

## Tu tarea

Auditar en profundidad y **corregir**, en este orden de prioridad:

1. **Corrección**: fallos reales, condiciones de carrera, fugas de memoria u object URLs no
   liberados, estado inconsistente si la sesión expira o la red cae a mitad de una subida,
   errores tragados en silencio.
2. **Mantenibilidad**: `app.js` mezcla demasiadas responsabilidades. Propón (y aplica si es
   seguro y sin build step) una separación en módulos ES por responsabilidad —auth, cámara,
   foco, cola, Drive, interfaz—, **manteniendo rutas relativas y carga sin bundler**. Si
   concluyes que dividirlo empeora las cosas para este caso, dilo y justifícalo: es una
   conclusión aceptable.
3. **Duplicación y complejidad**: lógica repetida, funciones con más de un propósito.
4. **Rendimiento en el teléfono**: batería y trabajo por fotograma. Solo con evidencia.

## Restricciones DURAS (romper cualquiera invalida el trabajo)

- NO cambiar `FOLDER_ID`, `CLIENT_ID` ni el scope de OAuth.
- NO introducir dependencias, frameworks, bundlers ni paso de build. Sigue siendo estático.
- NO levantar servidores locales ni intentar probar en el PC: la app no se usa ahí. Verifica
  por código (`node --check`) y por lectura. Si levantas algo en el puerto 8000, mátalo.
- NO romper el aspecto actual: interfaz **sin marcos**, el visor ocupa la pantalla entera
  (`.stage`) y los controles flotan encima (`.hud`). El marco de foco abarca el encuadre útil
  y usa cantoneras enmascaradas.
- NO reintroducir una interfaz con panel/recuadro alrededor del visor.
- Si tocas cualquier archivo cacheado, sube `CACHE_NAME` en `service-worker.js` (va por v9).
- NO hacer commit ni push. Deja los cambios en el árbol de trabajo; los reviso yo.
- `apply_patch` falla en este OneDrive: escribe los archivos con PowerShell here-strings.

## Entregable

Un informe con el formato de salida indicado arriba, y al final una lista explícita de:
- archivos modificados y por qué,
- fallos encontrados y no corregidos (con el motivo),
- lo que consideres que NO debe cambiarse y por qué.
