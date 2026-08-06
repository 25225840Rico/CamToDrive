// Configuracion de CamToDrive.
//
// CLIENT_ID:
// 1. Entra a Google Cloud Console.
// 2. Crea un OAuth Client ID de tipo "Web application".
// 3. Copia aqui el Client ID terminado en ".apps.googleusercontent.com".
// 4. Agrega tu URL de GitHub Pages en "Authorized JavaScript origins".
const CLIENT_ID = "430217123425-7lad1gutumj5lreq7d5jsb6153ab0rlv.apps.googleusercontent.com";

// Correos autorizados a subir fotos. LA PROTECCION MAS IMPORTANTE DE LA APP.
//
// En Google Drive el propietario de un archivo es SIEMPRE quien lo sube, no el dueno de la
// carpeta. Si el navegador tiene la sesion de otra cuenta activa, Google puede entregar un
// token de ESA cuenta sin mostrar ninguna pantalla, y las fotos quedan en su Drive aunque
// caigan dentro de la carpeta correcta. Eso ya paso: el 31 de julio de 2026 un lote de fotos
// quedo a nombre de otra cuenta sin que la app diera el menor aviso.
//
// Con esta lista la app verifica de quien es el token ANTES de subir nada y bloquea la
// subida si no coincide. Deja la lista vacia ([]) solo si aceptas que suba cualquier cuenta.
const ALLOWED_EMAILS = ["aronricocl@gmail.com"];

// Nombre de la carpeta (solo se usa como respaldo si NO se define FOLDER_ID).
const FOLDER_NAME = "Fotos App";

// ID de una carpeta EXISTENTE de tu Google Drive donde se guardaran todas las fotos.
// Se obtiene de la URL de la carpeta: drive.google.com/drive/folders/<ESTE_ID>
// Si se define, la app sube directo aqui (requiere scope de Drive completo).
// Si se deja vacio (""), la app crea/reutiliza una carpeta llamada FOLDER_NAME.
const FOLDER_ID = "1BCGezpp8M6vuQN4TL_l-atJtLPEOJ0f2";

// Resolucion que se le pide a la camara continua. La app pide siempre el maximo que el
// dispositivo acepte; estos valores son el "ideal" inicial antes de subir al maximo real.
const CAPTURE_IDEAL_WIDTH = 4096;
const CAPTURE_IDEAL_HEIGHT = 3072;

// Tope de megapixeles del visor continuo. PALANCA DE BATERIA: un stream de 12 MP a 30 fps
// es lo que mas consume de toda la app. En iOS la foto se saca del fotograma del visor, asi
// que bajar esto baja la calidad de la foto en la misma proporcion.
//   12000000 = ~12 MP, sin recorte practico en un iPhone (mas duracion de bateria: baja)
//    8000000 = ~8 MP, buen equilibrio
//    4000000 = ~4 MP, maxima duracion de bateria
const CAPTURE_MAX_PIXELS = 8000000;

// Fotogramas por segundo del visor. Menos fps = menos trabajo del ISP = menos bateria.
// Para encuadrar y disparar, 24 se ve igual de fluido que 30.
const CAPTURE_FRAME_RATE = 24;

// Segundos de inactividad tras los que la camara se apaga sola (0 = nunca).
// Es el ahorro mas grande: la camara encendida consume aunque no dispares.
const CAMERA_IDLE_TIMEOUT_SECONDS = 60;

// Pedir confirmacion de la foto antes de encolarla (vista previa con Usar / Repetir).
const CONFIRM_BEFORE_UPLOAD = true;

// Calidad del JPEG cuando la foto se saca del visor continuo (iOS Safari).
// 1 = maxima calidad posible del encoder (archivos mas grandes).
// Nota: esta ruta SIEMPRE pierde calidad frente a la camara nativa del sistema, porque
// captura un fotograma de video (sin HDR ni el procesado fotografico del telefono).
const CAPTURE_QUALITY = 1;

const CONFIG = Object.freeze({
  CLIENT_ID,
  ALLOWED_EMAILS,
  FOLDER_NAME,
  FOLDER_ID,
  CAPTURE_IDEAL_WIDTH,
  CAPTURE_IDEAL_HEIGHT,
  CAPTURE_MAX_PIXELS,
  CAPTURE_FRAME_RATE,
  CAMERA_IDLE_TIMEOUT_SECONDS,
  CONFIRM_BEFORE_UPLOAD,
  CAPTURE_QUALITY,
});
