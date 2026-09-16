const { app, BrowserWindow, Menu, shell, ipcMain, dialog, screen } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { pathToFileURL } = require('url');

let mainWindow = null;
let previewWindow = null;
let printerProbeWindow = null;
let currentPdfPath = null;

// Recuerda las últimas opciones de papel/orientación usadas, para que el
// modal de vista previa se abra ya con el mismo tamaño que eligió el
// usuario en el editor principal (en vez de reiniciar siempre en A4).
let currentPrintOptions = { pageSize: 'A4', landscape: false };

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
// Tamaños de página en micrones (anchura x altura, en orientación
// vertical/portrait). Se usan como respaldo cuando el nombre de papel
// como string ("A4", "Legal", etc.) no es respetado por el driver de la
// impresora en modo de impresión silenciosa (bug conocido de Electron/
// Chromium en Windows: el string de pageSize a veces se ignora y cae al
// tamaño predeterminado del driver, normalmente Carta/Letter).
// Los valores están en micrones, tal como los espera Electron cuando
// pageSize es un objeto {width, height}.
// ---------------------------------------------------------------
const PAGE_SIZES_MICRONS = {
  A3: { width: 297000, height: 420000 },
  A4: { width: 210000, height: 297000 },
  A5: { width: 148000, height: 210000 },
  Legal: { width: 215900, height: 355600 },
  Letter: { width: 215900, height: 279400 },
  Tabloid: { width: 279400, height: 431800 }
};

// Convierte el nombre de papel elegido por el usuario en el objeto de
// medidas exactas que se le pasa a webContents.print(). Si el usuario
// pasa landscape:true, invertimos ancho/alto aquí mismo y llamamos a
// print() con landscape:false, para evitar que Electron intente rotar
// dos veces (una vez nosotros, otra vez el propio flag landscape).
function resolvePrintPageSize(pageSize, landscape) {
  const size = PAGE_SIZES_MICRONS[pageSize];
  if (!size) return pageSize; // nombre no reconocido: se deja tal cual
  return landscape ? { width: size.height, height: size.width } : { width: size.width, height: size.height };
}

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
  previewWindow.webContents.on('preload-error', (event, preloadPath, error) => {
    writeLog('ERROR EN PRELOAD DE PREVIEW:', preloadPath, error);
  });
  previewWindow.webContents.on('render-process-gone', (event, details) => {
    writeLog('PREVIEWWINDOW RENDER-PROCESS-GONE:', details);
  });
  previewWindow.webContents.on('unresponsive', () => {
    writeLog('PREVIEWWINDOW UNRESPONSIVE');
  });

  // Atajo para abrir DevTools también en la app empaquetada (Ctrl+Shift+I
  // no funciona sin menú; esto lo fuerza manualmente).
  previewWindow.webContents.on('before-input-event', (event, input) => {
    if (input.control && input.shift && input.key.toLowerCase() === 'i') {
      previewWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

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
async function setMainWindowFieldsForOutput(plainText) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const fieldScript = plainText
    ? "document.querySelectorAll('.campo').forEach((span) => { span.textContent = (span.getAttribute('data-value') || '').trim(); });"
    : "document.querySelectorAll('.campo').forEach((span) => { const value = (span.getAttribute('data-value') || '').trim(); const label = span.getAttribute('data-label') || ''; span.textContent = value || '[' + label + ']'; });";
  await mainWindow.webContents.executeJavaScript(`(() => { ${fieldScript} })()`, true);
}

async function generatePdfPreview(opts) {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const options = opts || {};
  let fieldsPrepared = false;
  try {
    await setMainWindowFieldsForOutput(true);
    fieldsPrepared = true;
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
    writeLog('generatePdfPreview OK:', currentPdfPath, 'opciones:', options);
    return pathToFileURL(currentPdfPath).href;
  } catch (err) {
    writeLog('Error generando la vista previa de impresión:', err);
    return null;
  } finally {
    if (fieldsPrepared) {
      try { await setMainWindowFieldsForOutput(false); } catch (err) { writeLog('Error restaurando campos:', err); }
    }
  }
}

// Genera el PDF inicial y abre la ventana modal, usando el tamaño de
// papel y la orientación que el usuario haya elegido en el editor
// principal (index.html). Si no llega nada, se usa A4 vertical como
// valor por defecto.
ipcMain.handle('rc-print', async (event, opts) => {
  const options = opts || {};
  currentPrintOptions = {
    pageSize: options.pageSize || 'A4',
    landscape: !!options.landscape
  };
  writeLog('rc-print opciones recibidas del editor:', currentPrintOptions);

  const url = await generatePdfPreview(currentPrintOptions);
  if (!url) return false;
  openPreviewWindow();
  return true;
});

// Regenera el PDF cuando el usuario cambia tipo de papel u orientación
// dentro del modal, para que la vista previa refleje el cambio.
ipcMain.handle('rc-update-preview', async (event, opts) => {
  const options = opts || {};
  currentPrintOptions = {
    pageSize: options.pageSize || 'A4',
    landscape: !!options.landscape
  };
  return await generatePdfPreview(currentPrintOptions);
});

ipcMain.handle('rc-get-pdf-path', () => {
  if (!currentPdfPath || !fs.existsSync(currentPdfPath)) return null;
  return pathToFileURL(currentPdfPath).href;
});

// Permite que preview.html, al abrirse, sincronice sus controles
// (tamaño de papel / orientación) con lo que ya se eligió en el editor,
// en vez de reiniciar siempre en A4 vertical.
ipcMain.handle('rc-get-print-options', () => currentPrintOptions);

// Ventana oculta dedicada solo a consultar impresoras. La separamos del
// webContents de mainWindow porque printToPDF() repetido (al cambiar papel
// u orientación en el preview) puede dejar el print backend en mal estado
// y getPrintersAsync() empieza a devolver [] sin lanzar error.
async function getSystemPrinters() {
  if (!printerProbeWindow || printerProbeWindow.isDestroyed()) {
    writeLog('getSystemPrinters: creando printerProbeWindow nueva');
    printerProbeWindow = new BrowserWindow({
      show: false,
      webPreferences: { sandbox: false }
    });
    printerProbeWindow.webContents.on('render-process-gone', (event, details) => {
      writeLog('PRINTERPROBEWINDOW RENDER-PROCESS-GONE:', details);
    });
    await printerProbeWindow.loadURL('about:blank');
  }
  try {
    const printers = await printerProbeWindow.webContents.getPrintersAsync();
    writeLog('rc-get-printers OK: encontradas', printers.length, 'impresoras');
    return printers;
  } catch (err) {
    writeLog('getSystemPrinters ERROR:', err);
    // Si falla, destruimos la ventana probe para forzar una nueva en el
    // siguiente intento, en vez de quedar atascados con un webContents malo.
    if (printerProbeWindow && !printerProbeWindow.isDestroyed()) {
      printerProbeWindow.destroy();
    }
    printerProbeWindow = null;
    return [];
  }
}

ipcMain.handle('rc-get-printers', async () => {
  return await getSystemPrinters();
});

// El trabajo de impresión real se ejecuta sobre la ventana principal
// (no sobre la vista previa), silencioso y con las opciones elegidas
// en el modal. Las reglas @media print de index.html se encargan de
// ocultar la interfaz y mostrar solo el contrato.
//
// IMPORTANTE sobre el tamaño de papel: en impresión silenciosa
// (silent:true) en Windows, Electron/Chromium a veces IGNORA el nombre
// de papel como string ("A4", "Legal", etc.) si el driver de la
// impresora no lo reconoce exactamente igual, y cae de vuelta al
// tamaño predeterminado del driver (casi siempre Carta/Letter). Para
// evitar esto, convertimos el nombre a medidas exactas en micrones
// (resolvePrintPageSize) antes de pasarlo a print(). Si el nombre no es
// uno de los reconocidos, se manda el string tal cual como respaldo.
ipcMain.handle('rc-execute-print', async (event, opts) => {
  writeLog('rc-execute-print opciones recibidas:', opts);

  try {
    await setMainWindowFieldsForOutput(true);
  } catch (err) {
    writeLog('Error preparando campos para imprimir:', err);
    return { success: false, errorType: 'prepare-fields-failed' };
  }

  return new Promise((resolve) => {
    const restoreAndResolve = (result) => {
      setMainWindowFieldsForOutput(false)
        .catch((err) => writeLog('Error restaurando campos tras imprimir:', err))
        .finally(() => resolve(result));
    };
    if (!mainWindow || mainWindow.isDestroyed()) {
      restoreAndResolve({ success: false });
      return;
    }
    try {
      const resolvedPageSize = resolvePrintPageSize(opts.pageSize || 'A4', !!opts.landscape);
      // Si resolvedPageSize es un objeto {width,height} ya viene con la
      // orientación aplicada, así que print() se llama con landscape:false
      // para que Chromium no intente rotarlo una segunda vez. Si es un
      // string (nombre no reconocido), se respeta el flag landscape normal.
      const isResolvedObject = typeof resolvedPageSize === 'object';
      writeLog('rc-execute-print pageSize resuelto:', resolvedPageSize, 'esObjeto:', isResolvedObject);

      mainWindow.webContents.print({
        silent: true, // clave: evita el diálogo nativo del SO
        deviceName: opts.deviceName,
        copies: Math.max(1, parseInt(opts.copies, 10) || 1),
        color: opts.color !== false,
        landscape: isResolvedObject ? false : !!opts.landscape,
        printBackground: opts.printBackground !== false,
        pageSize: resolvedPageSize,
        margins: { marginType: opts.marginsType || 'default' }
      }, (success, errorType) => {
        writeLog('rc-execute-print resultado:', success, errorType);
        restoreAndResolve({ success, errorType: errorType || null });
      });
    } catch (err) {
      writeLog('Error ejecutando impresión:', err);
      restoreAndResolve({ success: false, errorType: 'print-failed' });
    }
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

  // Detecta si el renderer de la ventana principal se cae o deja de
  // responder. Si esto ocurre, printToPDF y getPrintersAsync fallarán
  // silenciosamente porque dependen de este webContents.
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
  if (printerProbeWindow && !printerProbeWindow.isDestroyed()) printerProbeWindow.destroy();
  if (process.platform !== 'darwin') app.quit();
});