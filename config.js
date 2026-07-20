// Configuracion de CamToDrive.
//
// CLIENT_ID:
// 1. Entra a Google Cloud Console.
// 2. Crea un OAuth Client ID de tipo "Web application".
// 3. Copia aqui el Client ID terminado en ".apps.googleusercontent.com".
// 4. Agrega tu URL de GitHub Pages en "Authorized JavaScript origins".
const CLIENT_ID = "430217123425-7lad1gutumj5lreq7d5jsb6153ab0rlv.apps.googleusercontent.com";

// Nombre de la carpeta que la app creara/reutilizara en la raiz de Google Drive.
const FOLDER_NAME = "Fotos App";

const CONFIG = Object.freeze({
  CLIENT_ID,
  FOLDER_NAME,
});
