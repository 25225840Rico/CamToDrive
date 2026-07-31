# Resumen de implementacion

CamToDrive sigue siendo una web app estatica sin backend, frameworks ni build step, lista para publicar en GitHub Pages con rutas relativas.

## Encargo 7 - interfaz Liquid Glass (solo movil)

Reemplaza la piel Windows 98. El aspecto no es decorativo: cada capa del material traduce una ley optica, y `styles.css` lleva la deduccion escrita en comentarios.

### Convencion de luz

Fuente virtual arriba-izquierda, 45 grados, ~5500 K (blanco calido). Toda luz alta va arriba-izquierda y toda sombra abajo-derecha. La coherencia direccional es lo que hace que el ojo lea "vidrio" y no "capa blanca translucida".

### Fisica aplicada

| Ley | Formula | Traduccion a CSS |
| --- | --- | --- |
| Fresnel (Schlick) | `R = R0 + (1-R0)(1-cos0)^5`, `R0 = ((n-1)/(n+1))^2` | Con n=1.5 el vidrio refleja 4% de frente y casi 100% a angulo rasante. El exponente 5 hace el salto brusco: el canto es una linea de 1 px muy brillante (`border` con `background-clip: border-box`), nunca un degradado ancho. Va en todo el perimetro, porque cualquier borde se ve en angulo rasante. |
| Reflexion especular (Blinn-Phong) | `I = ks (N.H)^a` | Vidrio pulido: exponente ~200, lobulo estrecho. El `radial-gradient` del reflejo es pequeno y esta arriba-izquierda, no lavado sobre toda la pieza. |
| Absorcion (Beer-Lambert) | `T = e^(-a d)` | El tinte depende del camino optico: los cantos se ven mas densos que el centro. El Fe(II) del vidrio flotado absorbe el rojo, de ahi el matiz verde-cian de los bordes (`--glass-tint`). |
| Dispersion (Cauchy) | `n = A + B/lambda^2` | El azul se desvia mas que el rojo: franja cian en un canto y ambar en el opuesto, al 3-4% de opacidad. Mas que eso deja de ser fisica y pasa a ser efecto. |
| Caustica | - | El vidrio curvo concentra la luz que lo atraviesa hacia el lado contrario a la fuente: resplandor teñido abajo-derecha en vez de una sombra gris. |
| Refraccion (Snell) | `n1 sen01 = n2 sen02` | Aproximada con `blur` + `saturate`: el desenfoque hace la refraccion difusa y el exceso de croma imita la ganancia de un medio denso. |

**Limite tecnico decisivo:** Safari/iOS **no** soporta `backdrop-filter: url(#filtro-svg)`, asi que el `feTurbulence` + `feDisplacementMap` que usa el Liquid Glass "real" para desviar el fondo solo funciona en Chromium. En el iPhone no se veria nada. Toda la optica se construye con `-webkit-backdrop-filter: blur() saturate() brightness()`, gradientes y sombras interiores, que Safari si acelera por GPU.

### Decisiones de interfaz

- El pulsado de un boton no cambia de color: **comprime el material**. Menos espesor implica menos camino optico, asi que baja el `blur`, baja el tinte y el reflejo se desplaza porque gira la normal de la superficie.
- Fondo con malla de gradientes: sin algo vivo detras, el vidrio no tiene que refractar y se ve como plastico gris. Los focos ademas le dan al material de donde sacar su color.
- Visor con relacion 3:4 y cantos de 30 px; el reflejo y la franja cromatica se pintan **sobre** el video (`z-index: 3`), porque ahi el vidrio esta delante de la imagen.
- Jerarquia sin cambios respecto del encargo anterior: **Disparar** es el boton dominante (76 px), **Conectar Google** encima y desaparece al autenticarse.
- Rendimiento: `contain: paint` en el visor y `backdrop-filter` limitado a pocas piezas, que en iPhone cada capa cuesta GPU.
- Reserva: `@supports not (backdrop-filter)` cambia el vidrio por un solido oscuro con el mismo canto Fresnel, que sigue siendo legible.
- Cache del shell subida a `camtodrive-shell-v7`; `theme_color` y `background_color` del manifest a `#070b18`.

## Encargo 6 - interfaz Windows 98 (superado por el encargo 7)

- Toda la app vive dentro de una unica "ventana" Win98: barra de titulo azul, cuerpo gris y barra de estado abajo. Fondo teal clasico.
- Jerarquia mas simple: visor grande arriba, **Disparar** como boton dominante (68 px de alto), **Conectar Google** encima y desaparece al autenticarse.
- Los contadores dejaron de ser tarjetas: van en la barra de estado (`estado | N en cola | N subiendo | red`), como en Windows.
- Ultimas fotos es un groupbox con la miniatura y un listbox hundido; la foto que se esta subiendo se resalta en azul de seleccion.
- Barras de progreso segmentadas en bloques, como las de Windows 98.
- Se elimino el modo oscuro y las sombras/redondeos: la paleta es fija (#c0c0c0 / #000080 / #008080) y el CSS quedo mas corto.
- `styles.css` no depende de ninguna fuente externa: `MS Sans Serif` con `Tahoma`/`Verdana` de respaldo (Verdana existe en iOS).
- Cache del shell subida a `camtodrive-shell-v6` y `theme_color` del manifest a `#008080`.

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
