const { app, BrowserWindow, Menu, shell, ipcMain, dialog, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');
 
let mainWindow = null;
let previewWindow = null;
let currentPdfPath = null;
 
// ---------------------------------------------------------------
// Auto-actualización (GitHub Releases)
// ---------------------------------------------------------------
autoUpdater.autoDownload = false; // descargamos solo cuando el usuario confirma
autoUpdater.autoInstallOnAppQuit = true;
 
function sendUpdateStatus(status, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', { status, data });
  }
}
 
autoUpdater.on('checking-for-update', () => {
  sendUpdateStatus('checking');
});
autoUpdater.on('update-available', (info) => {
  sendUpdateStatus('available', { version: info.version });
  autoUpdater.downloadUpdate();
});
autoUpdater.on('update-not-available', () => {
  sendUpdateStatus('not-available');
});
autoUpdater.on('download-progress', (progress) => {
  sendUpdateStatus('downloading', { percent: Math.round(progress.percent) });
});
autoUpdater.on('update-downloaded', () => {
  sendUpdateStatus('downloaded');
});
autoUpdater.on('error', (err) => {
  sendUpdateStatus('error', { message: err == null ? 'Error desconocido' : err.message });
});
 
ipcMain.handle('rc-check-for-updates', async () => {
  if (!app.isPackaged) {
    // En desarrollo (npm start) no hay instalador que actualizar; evita el error
    // "dev-app-update.yml" que lanza electron-updater fuera de una app empaquetada.
    sendUpdateStatus('dev-mode');
    return;
  }
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    sendUpdateStatus('error', { message: err.message });
  }
});
 
ipcMain.handle('rc-install-update-now', () => {
  autoUpdater.quitAndInstall();
});
 
// ---------------------------------------------------------------
// Vista previa de impresión (ventana modal)
// ---------------------------------------------------------------
 
// Abre la ventana modal ocupando toda la resolución disponible de la
// pantalla (se calcula con `screen.getPrimaryDisplay()` y además se
// maximiza, para cubrir también monitores con distinta densidad/escala).
function openPreviewWindow() {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.focus();
    return;
  }
  const { workAreaSize, workArea } = screen.getPrimaryDisplay();
 
  previewWindow = new BrowserWindow({
    width: workAreaSize.width,
    height: workAreaSize.height,
    x: workArea.x,
    y: workArea.y,
    minWidth: 760,
    minHeight: 600,
    parent: mainWindow,
    modal: true,
    show: false,
    backgroundColor: '#1E2A38',
    title: 'Vista previa de impresión',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preview-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
 
  previewWindow.setMenuBarVisibility(false);
  previewWindow.loadFile(path.join(__dirname, 'renderer', 'preview.html'));
 
  previewWindow.once('ready-to-show', () => {
    previewWindow.maximize();
    previewWindow.show();
  });
 
  previewWindow.on('closed', () => {
    previewWindow = null;
  });
}
 
// Genera (o regenera) el PDF de vista previa a partir del contenido
// actual de la ventana principal, respetando el tamaño de papel y la
// orientación elegidos. Devuelve la URL file:// del PDF o null si falla.
async function generatePdfPreview(opts) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const options = opts || {};
  try {
    const pdfBuffer = await mainWindow.webContents.printToPDF({
      printBackground: true,
      landscape: !!options.landscape,
      pageSize: options.pageSize || 'A4',
      margins: { marginType: 'default' }
    });
 
    if (currentPdfPath && fs.existsSync(currentPdfPath)) {
      try { fs.unlinkSync(currentPdfPath); } catch (e) { /* no crítico */ }
    }
    currentPdfPath = path.join(os.tmpdir(), `contrato-preview-${Date.now()}.pdf`);
    fs.writeFileSync(currentPdfPath, pdfBuffer);
    return pathToFileURL(currentPdfPath).href;
  } catch (err) {
    console.error('Error generando la vista previa de impresión:', err);
    return null;
  }
}
 
// Genera el PDF inicial (A4, vertical) y abre la ventana modal.
ipcMain.handle('rc-print', async () => {
  const url = await generatePdfPreview({ pageSize: 'A4', landscape: false });
  if (!url) return false;
  openPreviewWindow();
  return true;
});
 
// Regenera el PDF cuando el usuario cambia tipo de papel u orientación
// dentro del modal, para que la vista previa refleje el cambio.
ipcMain.handle('rc-update-preview', async (event, opts) => {
  return await generatePdfPreview(opts);
});
 
ipcMain.handle('rc-get-pdf-path', () => {
  if (!currentPdfPath || !fs.existsSync(currentPdfPath)) return null;
  return pathToFileURL(currentPdfPath).href;
});
 
ipcMain.handle('rc-get-printers', async () => {
  try {
    return await mainWindow.webContents.getPrintersAsync();
  } catch (err) {
    return [];
  }
});
 
// El trabajo de impresión real se ejecuta sobre la ventana principal
// (no sobre la vista previa), silencioso y con las opciones elegidas
// en el modal. Las reglas @media print de index.html se encargan de
// ocultar la interfaz y mostrar solo el contrato.
ipcMain.handle('rc-execute-print', (event, opts) => {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) { resolve({ success: false }); return; }
    mainWindow.webContents.print({
      silent: true, // clave: evita el diálogo nativo del SO
      deviceName: opts.deviceName,
      copies: Math.max(1, parseInt(opts.copies, 10) || 1),
      color: opts.color !== false,
      landscape: !!opts.landscape,
      printBackground: opts.printBackground !== false,
      pageSize: opts.pageSize || 'A4',
      margins: { marginType: opts.marginsType || 'default' }
    }, (success, errorType) => {
      resolve({ success, errorType: errorType || null });
    });
  });
});
 
ipcMain.handle('rc-save-pdf', async () => {
  if (!currentPdfPath || !fs.existsSync(currentPdfPath)) return { success: false };
  const { canceled, filePath } = await dialog.showSaveDialog(previewWindow, {
    defaultPath: 'contrato.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  });
  if (canceled || !filePath) return { success: false, canceled: true };
  fs.copyFileSync(currentPdfPath, filePath);
  return { success: true, filePath };
});
 
ipcMain.handle('rc-close-preview', () => {
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close();
});
 
function createWindow() {
  const { workAreaSize, workArea } = screen.getPrimaryDisplay();
 
  mainWindow = new BrowserWindow({
    width: workAreaSize.width,
    height: workAreaSize.height,
    x: workArea.x,
    y: workArea.y,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#1E2A38',
    title: 'Redactor de Contratos',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // File System Access API (showDirectoryPicker) necesita esto en false
      v8CacheOptions: 'none'
    },
    autoHideMenuBar: true,
    show: false
  });
 
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
 
  // Muestra la ventana solo cuando el contenido ya está listo (evita el "flash" blanco)
  // y la maximiza para ocupar toda la resolución detectada de la pantalla.
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
 
  // Abre enlaces externos (http/https) en el navegador del sistema, no dentro de la app
  // Permite ventanas internas (diálogos de impresión, etc.) bloqueando solo URLs externas
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // Permite diálogos internos (print, etc.) que no tienen URL o tienen about:blank
    return { action: 'allow' };
  });
 
  // Menú mínimo (con recargar y devtools solo en desarrollo)
  const isDev = !app.isPackaged;
  const template = [
    {
      label: 'Archivo',
      submenu: [
        { role: 'quit', label: 'Salir' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Deshacer' },
        { role: 'redo', label: 'Rehacer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Pegar' },
        { role: 'selectAll', label: 'Seleccionar todo' }
      ]
    },
    {
      label: 'Ver',
      submenu: isDev
        ? [
            { role: 'reload', label: 'Recargar' },
            { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
            { type: 'separator' },
            { role: 'resetZoom', label: 'Zoom normal' },
            { role: 'zoomIn', label: 'Acercar' },
            { role: 'zoomOut', label: 'Alejar' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: 'Pantalla completa' }
          ]
        : [
            { role: 'resetZoom', label: 'Zoom normal' },
            { role: 'zoomIn', label: 'Acercar' },
            { role: 'zoomOut', label: 'Alejar' },
            { type: 'separator' },
            { role: 'togglefullscreen', label: 'Pantalla completa' }
          ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
 
app.whenReady().then(() => {
  createWindow();
 
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
 
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
