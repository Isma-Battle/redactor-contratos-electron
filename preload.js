// Este preload se ejecuta en un contexto aislado, con acceso a Node,
// antes de cargar la página. La app usa fetch(), localStorage y la
// File System Access API del propio navegador (Chromium), que ya
// funcionan sin ayuda de Node. Lo único que exponemos aquí es la API
// de actualizaciones, para el botón "Buscar actualizaciones".

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('rcUpdater', {
  check: () => ipcRenderer.invoke('rc-check-for-updates'),
  installNow: () => ipcRenderer.invoke('rc-install-update-now'),
  onStatus: (callback) => {
    ipcRenderer.on('update-status', (_event, payload) => callback(payload));
  }
});
