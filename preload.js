// Este preload se ejecuta en un contexto aislado, con acceso a Node,
// antes de cargar la página. La app usa fetch(), localStorage y la
// File System Access API del propio navegador (Chromium), que ya
// funcionan sin ayuda de Node. Lo que exponemos aquí es la API de
// actualizaciones (botón "Buscar actualizaciones") y la API de
// impresión.
//
// La impresión ya NO abre una ventana de vista previa propia de
// Electron: print(payload) manda el HTML final del contrato (ya
// resuelto: campos con su valor, imágenes con su posición) junto con
// el tamaño de papel y la orientación elegidos, y main.js lo escribe a
// un archivo temporal que abre con el navegador predeterminado del
// sistema operativo. Desde ahí el usuario imprime con el propio
// diálogo del navegador (Ctrl+P).

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rcUpdater', {
  check: () => ipcRenderer.invoke('rc-check-for-updates'),
  installNow: () => ipcRenderer.invoke('rc-install-update-now'),
  onStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, payload) => callback(payload));
  }
});

contextBridge.exposeInMainWorld('rcPrint', {
  // payload: { bodyHtml, pageSize, landscape, title }
  // Devuelve { success: true, filePath } o { success: false, error }.
  print: (payload) => ipcRenderer.invoke('rc-print', payload)
});