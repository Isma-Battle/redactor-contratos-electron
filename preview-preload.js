// Preload de la ventana de vista previa de impresión (previewWindow).
// Expone la API que usa preview.html: obtener la URL del PDF generado,
// la lista de impresoras, ejecutar la impresión real (sobre la ventana
// principal), guardar el PDF y cerrar el modal.
 console.log('>>> preview-preload.js se está ejecutando');
const { contextBridge, ipcRenderer } = require('electron');
 
contextBridge.exposeInMainWorld('previewAPI', {
  getPdfUrl: () => ipcRenderer.invoke('rc-get-pdf-path'),
  // Regenera el PDF de vista previa cuando cambia el tipo de papel o la
  // orientación, para que lo que se ve coincida con lo que se imprimirá.
  updatePreview: (opts) => ipcRenderer.invoke('rc-update-preview', opts),
  getPrinters: () => ipcRenderer.invoke('rc-get-printers'),
  executePrint: (opts) => ipcRenderer.invoke('rc-execute-print', opts),
  savePdf: () => ipcRenderer.invoke('rc-save-pdf'),
  close: () => ipcRenderer.invoke('rc-close-preview')
});
 
