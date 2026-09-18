const { app, BrowserWindow, Menu, shell, ipcMain, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');

let mainWindow = null;

// Ruta del último documento de impresión generado, para poder borrarlo
// antes de crear uno nuevo (no queremos ir acumulando archivos temporales).
let lastPrintFilePath = null;

// ---------------------------------------------------------------
// Logging a archivo (para poder diagnosticar en la app empaquetada,
// donde no hay terminal ni DevTools accesibles fácilmente).
// El archivo queda en la carpeta de datos de usuario de la app, p. ej.
// en Windows: C:\Users\<usuario>\AppData\Roaming\<NombreApp>\debug.log
// ---------------------------------------------------------------
const logFilePath = path.join(app.getPath('userData'), 'debug.log');

function writeLog(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map(p => {
    if (p instanceof Error) return p.stack || p.message;
    if (typeof p === 'object') { try { return JSON.stringify(p); } catch (e) { return String(p); } }
    return String(p);
  }).join(' ')}\n`;
  try {
    fs.appendFileSync(logFilePath, line);
  } catch (e) { /* si ni esto funciona, no hay mucho más que hacer */ }
  // También lo mandamos a consola por si en algún momento hay terminal disponible.
  console.log(line.trim());
}

process.on('uncaughtException', (err) => {
  writeLog('UNCAUGHT EXCEPTION EN MAIN:', err);
});
process.on('unhandledRejection', (reason) => {
  writeLog('UNHANDLED REJECTION EN MAIN:', reason);
});

writeLog('--- App iniciada. Log en:', logFilePath, '---');

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
// Impresión: ya NO se usa una ventana de vista previa propia de
// Electron ni webContents.print()/printToPDF(). En su lugar:
//
//   1. El renderer (index.html) ya construye el HTML final del
//      contrato (campos resueltos a su valor, imágenes con su
//      posición) mediante buildExportHtml() y lo envía aquí junto con
//      el tamaño de papel y la orientación elegidos.
//   2. Aquí se envuelve ese HTML en un documento completo con su
//      propio <style> (incluida la regla @page con el tamaño elegido)
//      y se escribe a un archivo .html temporal.
//   3. shell.openPath() abre ese archivo con la aplicación asociada a
//      .html en el sistema operativo -normalmente el navegador
//      predeterminado de Windows (Chrome, Edge, Firefox, etc.)-, FUERA
//      de Electron por completo.
//   4. Desde ahí el usuario imprime con el propio diálogo del
//      navegador (Ctrl+P), que sí respeta el tamaño de papel elegido
//      y no sufre el bug de impresión silenciosa de Electron/Chromium
//      en Windows que ignoraba el pageSize.
// ---------------------------------------------------------------
ipcMain.handle('rc-print', async (event, payload) => {
  const opts = payload || {};
  const bodyHtml = opts.bodyHtml || '';
  const pageSize = opts.pageSize || 'A4';
  const landscape = !!opts.landscape;
  const rawTitle = (opts.title || 'contrato').toString();

  writeLog('rc-print: generando documento para el navegador. Opciones:', { pageSize, landscape, title: rawTitle });

  if (!bodyHtml.trim()) {
    return { success: false, error: 'sin-contenido' };
  }

  const pageSizeCss = landscape ? `${pageSize} landscape` : pageSize;

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${rawTitle}</title>
<style>
  @page { size: ${pageSizeCss}; margin: 2cm; }
  html,body{ margin:0; padding:0; }
  body{
    font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    font-size:12pt;
    line-height:1.6;
    color:#1a1a1a;
    padding: 24px 32px;
    background:#fff;
    max-width: 900px;
    margin: 0 auto;
  }
  p{ margin:0 0 12pt 0; }
  img{ max-width:100%; }
  .print-hint{
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #666;
    background: #fff8e1;
    border: 1px solid #f0d98c;
    border-radius: 6px;
    padding: 10px 14px;
    margin-bottom: 18px;
  }
  @media print{
    .print-hint{ display:none; }
    body{ padding: 0; max-width:none; }
  }
</style>
</head>
<body>
<div class="print-hint">Para imprimir, usa Ctrl+P (o el menú del navegador). El tamaño de papel "${pageSize}"${landscape ? ' horizontal' : ''} ya viene preconfigurado; puedes cambiarlo también en el propio diálogo de impresión del navegador.</div>
${bodyHtml}
</body>
</html>`;

  try {
    // Borra el documento de impresión anterior antes de crear uno nuevo.
    if (lastPrintFilePath && fs.existsSync(lastPrintFilePath)) {
      try { fs.unlinkSync(lastPrintFilePath); } catch (e) { /* no crítico */ }
    }
    const safeTitle = rawTitle.replace(/[^a-zA-Z0-9_\-]/g, '_') || 'contrato';
    lastPrintFilePath = path.join(os.tmpdir(), `${safeTitle}-${Date.now()}.html`);
    fs.writeFileSync(lastPrintFilePath, html, 'utf8');
    writeLog('rc-print: archivo generado en', lastPrintFilePath);

    const errorMsg = await shell.openPath(lastPrintFilePath);
    if (errorMsg) {
      // shell.openPath devuelve un string vacío si todo salió bien, o un
      // mensaje de error si no pudo abrir el archivo (por ejemplo, si no
      // hay ninguna aplicación asociada a .html en el sistema).
      writeLog('rc-print: shell.openPath devolvió error:', errorMsg);
      return { success: false, error: errorMsg };
    }
    return { success: true, filePath: lastPrintFilePath };
  } catch (err) {
    writeLog('rc-print ERROR:', err);
    return { success: false, error: err.message };
  }
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

  // Detecta si el renderer de la ventana principal se cae o deja de
  // responder.
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    writeLog('MAINWINDOW RENDER-PROCESS-GONE:', details);
  });
  mainWindow.webContents.on('unresponsive', () => {
    writeLog('MAINWINDOW UNRESPONSIVE');
  });
  mainWindow.webContents.on('responsive', () => {
    writeLog('MAINWINDOW VOLVIO A RESPONDER');
  });
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  // Muestra la ventana solo cuando el contenido ya está listo (evita el "flash" blanco)
  // y la maximiza para ocupar toda la resolución detectada de la pantalla.
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  // Abre enlaces externos (http/https) en el navegador del sistema, no dentro de la app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
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