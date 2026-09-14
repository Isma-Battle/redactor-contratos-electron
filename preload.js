// Este preload se ejecuta en un contexto aislado, con acceso a Node,
// antes de cargar la página. La app usa fetch(), localStorage y la
// File System Access API del propio navegador (Chromium), que ya
// funcionan sin ayuda de Node. Lo que exponemos aquí es la API de
// actualizaciones (botón "Buscar actualizaciones") y la API de
// impresión, que genera el PDF de vista previa y abre el modal.
 
const { contextBridge, ipcRenderer } = require('electron');
 
contextBridge.exposeInMainWorld('rcUpdater', {
  check: () => ipcRenderer.invoke('rc-check-for-updates'),
  installNow: () => ipcRenderer.invoke('rc-install-update-now'),
  onStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, payload) => callback(payload));
  }
});
 
contextBridge.exposeInMainWorld('rcPrint', {
  // Genera el PDF de vista previa a partir del contenido actual del
  // editor y abre la ventana modal de impresión. Devuelve true/false.
  print: () => ipcRenderer.invoke('rc-print')
});
