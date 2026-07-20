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

const CONFIG = Object.freeze({
  CLIENT_ID,
  FOLDER_NAME,
  FOLDER_ID,
});
