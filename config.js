// Configuracion de CamToDrive.
//
// CLIENT_ID:
// 1. Entra a Google Cloud Console.
// 2. Crea un OAuth Client ID de tipo "Web application".
// 3. Copia aqui el Client ID terminado en ".apps.googleusercontent.com".
// 4. Agrega tu URL de GitHub Pages en "Authorized JavaScript origins".
const CLIENT_ID = "430217123425-7lad1gutumj5lreq7d5jsb6153ab0rlv.apps.googleusercontent.com";

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
