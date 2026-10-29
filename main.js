const { app, BrowserWindow, Menu, shell, ipcMain, screen, dialog, safeStorage } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { buildXlsx } = require('./xlsx-writer');

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
  const margen = opts.margen;
  const rawTitle = (opts.title || 'contrato').toString();

  writeLog('rc-print: generando documento para el navegador. Opciones:', { pageSize, landscape, margen, title: rawTitle });

  if (!bodyHtml.trim()) {
    return { success: false, error: 'sin-contenido' };
  }

  const html = documentoImprimible({ bodyHtml, pageSize, landscape, margen, title: rawTitle, aviso: true });

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

// Documento HTML completo para imprimir o convertir a PDF: página del
// tamaño elegido (@page) con los márgenes del redactor (2 cm por defecto)
// y la misma tipografía y espaciado que la hoja del editor, para que cada
// página salga como se ve allí (los párrafos no se parten entre páginas,
// igual que en el editor). En pantalla, el navegador lo muestra como una
// hoja de ese tamaño. "aviso" añade la nota de Ctrl+P, que solo tiene
// sentido en el navegador.
const PAPELES = { Letter: ['8.5in', '11in'], A4: ['210mm', '297mm'], Legal: ['8.5in', '14in'], A3: ['297mm', '420mm'], A5: ['148mm', '210mm'], Tabloid: ['11in', '17in'] };
function documentoImprimible({ bodyHtml, pageSize, landscape, margen, title, aviso }) {
  const pageSizeCss = landscape ? `${pageSize} landscape` : pageSize;
  const m = /^\d+(\.\d+)?(cm|mm|in)$/.test(String(margen || '')) ? margen : '2cm';
  const [pw, ph] = PAPELES[pageSize] || PAPELES.Letter;
  const [ancho, alto] = landscape ? [ph, pw] : [pw, ph];
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<link href="https://fonts.googleapis.com/css2?family=Source+Serif+4:opsz,wght@8..60,400;8..60,600;8..60,700&display=swap" rel="stylesheet">
<style>
  @page { size: ${pageSizeCss}; margin: ${m}; }
  html,body{ margin:0; padding:0; }
  body{
    font-family: 'Source Serif 4', Georgia, 'Times New Roman', serif;
    font-size:12pt;
    line-height:1.6;
    font-optical-sizing:none;
    color:#1a1a1a;
    background:#fff;
    position:relative;
  }
  p{ margin:0 0 12pt 0; }
  h1{ font-size:20pt; line-height:1.3; margin:0 0 12pt; }
  h2{ font-size:16pt; line-height:1.3; margin:14pt 0 8pt; }
  h3{ font-size:13pt; line-height:1.3; margin:12pt 0 6pt; }
  /* Como en el editor (y Word): los párrafos se parten entre páginas dejando al menos 2 líneas en cada una. */
  p, li, blockquote, div{ orphans:2; widows:2; }
  h1, h2, h3, tr{ break-inside:avoid; }
  img{ max-width:100%; }
  .print-hint{
    font-family: Arial, sans-serif;
    font-size: 11px;
    color: #666;
    background: #fff8e1;
    border: 1px solid #f0d98c;
    border-radius: 6px;
    padding: 10px 14px;
    margin: 18px auto;
    max-width: ${ancho};
    box-sizing: border-box;
  }
  @media screen{
    html{ background:#e3e6ec; }
    body{
      box-sizing:border-box;
      width:${ancho};
      min-height:${alto};
      border:${m} solid #fff; /* borde y no padding: las imágenes libres cuentan desde el área de texto, como al imprimir */
      margin:0 auto 32px;
      box-shadow:0 4px 18px rgba(0,0,0,.18);
    }
    .print-hint{ position:absolute; left:0; right:0; top:-64px; }
    body.con-aviso{ margin-top:84px; }
  }
  @media print{
    .print-hint{ display:none; }
    html{ background:#fff; }
  }
</style>
</head>
<body${aviso ? ' class="con-aviso"' : ''}>
${aviso ? `<div class="print-hint">Ctrl+P para imprimir. Papel "${pageSize}"${landscape ? ' horizontal' : ''} y márgenes ya configurados.</div>` : ''}
${bodyHtml}
</body>
</html>`;
}

// ---------------------------------------------------------------
// Datos de gestión (edificios, apartamentos, inquilinos, contratos).
// Se guardan en un archivo JSON dentro de la carpeta de datos de
// usuario de la app (no en localStorage), p. ej. en Windows:
// C:\Users\<usuario>\AppData\Roaming\<NombreApp>\renthouse-datos.json
//
// Cada guardado escribe primero a un archivo temporal y luego lo
// renombra, para que un corte a mitad de escritura no deje el archivo
// a medias. La versión anterior queda como copia en .bak, y si el
// archivo principal no se puede leer se intenta recuperar desde ahí.
// ---------------------------------------------------------------
const dataFilePath = path.join(app.getPath('userData'), 'renthouse-datos.json');
const dataBackupPath = dataFilePath + '.bak';

function readDataFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

ipcMain.handle('rc-data-load', () => {
  if (!fs.existsSync(dataFilePath)) {
    if (!fs.existsSync(dataBackupPath)) return { ok: true, data: null };
  } else {
    try {
      return { ok: true, data: readDataFile(dataFilePath) };
    } catch (err) {
      writeLog('rc-data-load: no se pudo leer el archivo principal:', err);
    }
  }
  try {
    const data = readDataFile(dataBackupPath);
    writeLog('rc-data-load: datos recuperados desde la copia .bak');
    return { ok: true, data, recoveredFromBackup: true };
  } catch (err) {
    writeLog('rc-data-load ERROR (también falló la copia .bak):', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rc-data-save', (event, data) => {
  try {
    const tmpPath = dataFilePath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(data), 'utf8');
    if (fs.existsSync(dataFilePath)) fs.copyFileSync(dataFilePath, dataBackupPath);
    fs.renameSync(tmpPath, dataFilePath);
  } catch (err) {
    writeLog('rc-data-save ERROR:', err);
    return { ok: false, error: err.message };
  }
  runDailyBackup();
  return { ok: true };
});

// ---------------------------------------------------------------
// Respaldo automático: una copia de los datos por día, en
// <carpeta de trabajo>/Respaldos (o en la carpeta de datos de la app
// si todavía no hay carpeta de trabajo). La copia del día se actualiza
// con cada guardado, así que siempre refleja lo último de ese día, y
// las de días anteriores quedan intactas. Se conservan BACKUP_KEEP días.
// Un respaldo se restaura con "Importar respaldo".
// ---------------------------------------------------------------
const BACKUP_DIR = 'Respaldos';
const BACKUP_KEEP = 30;
const BACKUP_PATTERN = /^renthouse-respaldo-\d{4}-\d{2}-\d{2}\.json$/;

function backupDir() {
  const info = folderInfo();
  return info.exists ? path.join(info.path, BACKUP_DIR) : path.join(app.getPath('userData'), BACKUP_DIR);
}

function localDateStamp() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function listBackups(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(name => BACKUP_PATTERN.test(name))
    .sort()
    .reverse();
}

function runDailyBackup() {
  try {
    if (!fs.existsSync(dataFilePath)) return;
    const dir = backupDir();
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'renthouse-respaldo-' + localDateStamp() + '.json');
    fs.copyFileSync(dataFilePath, file + '.tmp');
    fs.renameSync(file + '.tmp', file);
    listBackups(dir).slice(BACKUP_KEEP).forEach(name => {
      try { fs.unlinkSync(path.join(dir, name)); } catch (err) { /* se reintenta en el próximo respaldo */ }
    });
  } catch (err) {
    writeLog('Respaldo automático ERROR:', err);
  }
}

ipcMain.handle('rc-backup-status', () => {
  const dir = backupDir();
  const backups = listBackups(dir);
  const last = backups[0] ? { name: backups[0], mtime: fs.statSync(path.join(dir, backups[0])).mtimeMs } : null;
  return { dir, inWorkFolder: folderInfo().exists, count: backups.length, keep: BACKUP_KEEP, last };
});

ipcMain.handle('rc-backup-open', async () => {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const error = await shell.openPath(dir);
  return { ok: !error, error };
});

// ---------------------------------------------------------------
// Carpeta de trabajo del redactor. La elige el usuario con el diálogo
// del sistema y se recuerda en renthouse-config.json (carpeta de datos
// de la app), así no hay que reactivar permisos en cada sesión como
// pasaba con la File System Access API del navegador.
//
//   <carpeta>/*.doc            documentos guardados
//   <carpeta>/Modelos/*.html   modelos reutilizables
//
// El renderer nunca manda rutas: solo el tipo ('documento' o 'modelo')
// y un nombre de archivo, que aquí se valida y se resuelve dentro de
// la carpeta elegida.
// ---------------------------------------------------------------
const configFilePath = path.join(app.getPath('userData'), 'renthouse-config.json');
const TEMPLATES_DIR = 'Modelos';

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFilePath, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeConfig(cfg) {
  fs.writeFileSync(configFilePath, JSON.stringify(cfg, null, 2), 'utf8');
}

function folderInfo() {
  const folder = readConfig().workFolder || null;
  return { path: folder, name: folder ? path.basename(folder) : null, exists: !!folder && fs.existsSync(folder) };
}

function resolveWorkFile(kind, name) {
  const folder = readConfig().workFolder;
  if (!folder) throw new Error('No hay carpeta de trabajo seleccionada.');
  const fileName = String(name || '');
  if (!fileName || path.basename(fileName) !== fileName || fileName.startsWith('.')) throw new Error('Nombre de archivo no válido.');
  if (kind === 'documento' && /\.docx?$/i.test(fileName)) return path.join(folder, fileName);
  if (kind === 'modelo' && /\.html$/i.test(fileName)) return path.join(folder, TEMPLATES_DIR, fileName);
  throw new Error('Tipo de archivo no permitido.');
}

function listFiles(dir, pattern) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isFile() && pattern.test(entry.name) && !entry.name.startsWith('~$'))
    .map(entry => {
      const stat = fs.statSync(path.join(dir, entry.name));
      return { name: entry.name, mtime: stat.mtimeMs, size: stat.size };
    });
}

ipcMain.handle('rc-folder-get', () => folderInfo());

ipcMain.handle('rc-folder-choose', async () => {
  const current = readConfig().workFolder;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Elegir carpeta de trabajo',
    buttonLabel: 'Usar esta carpeta',
    defaultPath: current && fs.existsSync(current) ? current : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return Object.assign({ canceled: true }, folderInfo());
  const cfg = readConfig();
  cfg.workFolder = result.filePaths[0];
  writeConfig(cfg);
  writeLog('Carpeta de trabajo:', cfg.workFolder);
  runDailyBackup(); // los respaldos pasan a la nueva carpeta desde ya
  return Object.assign({ canceled: false }, folderInfo());
});

ipcMain.handle('rc-folder-list', () => {
  const info = folderInfo();
  if (!info.exists) return { ok: false, error: info.path ? 'no-existe' : 'sin-carpeta' };
  try {
    return {
      ok: true,
      documentos: listFiles(info.path, /\.docx?$/i),
      modelos: listFiles(path.join(info.path, TEMPLATES_DIR), /\.html$/i)
    };
  } catch (err) {
    writeLog('rc-folder-list ERROR:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rc-folder-read', (event, kind, name) => {
  try {
    return { ok: true, text: fs.readFileSync(resolveWorkFile(kind, name), 'utf8') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rc-folder-write', (event, kind, name, text, overwrite) => {
  try {
    const file = resolveWorkFile(kind, name);
    if (!overwrite && fs.existsSync(file)) return { ok: false, error: 'existe' };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, String(text), 'utf8');
    return { ok: true };
  } catch (err) {
    writeLog('rc-folder-write ERROR:', err);
    return { ok: false, error: err.message };
  }
});

// Borrar = mandar a la papelera, para poder recuperarlo.
ipcMain.handle('rc-folder-trash', async (event, kind, name) => {
  try {
    await shell.trashItem(resolveWorkFile(kind, name));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------
// Expedientes de inquilinos: archivos adjuntos (cédula escaneada,
// contrato firmado...) en <carpeta de trabajo>/Expedientes/<carpeta>.
// El renderer manda solo el nombre de la carpeta del expediente y del
// archivo; aquí se validan para que no salgan de esa ruta.
// ---------------------------------------------------------------
const EXPEDIENTES_DIR = 'Expedientes';

function expedienteDir(folderName) {
  const info = folderInfo();
  if (!info.exists) throw new Error('sin-carpeta');
  const name = String(folderName || '');
  if (!name || path.basename(name) !== name || name.startsWith('.')) throw new Error('Expediente no válido.');
  return path.join(info.path, EXPEDIENTES_DIR, name);
}

function expedienteFile(folderName, fileName) {
  const name = String(fileName || '');
  if (!name || path.basename(name) !== name || name.startsWith('.')) throw new Error('Archivo no válido.');
  return path.join(expedienteDir(folderName), name);
}

ipcMain.handle('rc-exp-list', (event, folderName) => {
  try {
    const dir = expedienteDir(folderName);
    return { ok: true, files: listFiles(dir, /./).sort((a, b) => b.mtime - a.mtime) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rc-exp-add', async (event, folderName) => {
  try {
    const dir = expedienteDir(folderName);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Adjuntar archivos al expediente',
      buttonLabel: 'Adjuntar',
      properties: ['openFile', 'multiSelections']
    });
    if (result.canceled || !result.filePaths.length) return { ok: true, added: [] };
    fs.mkdirSync(dir, { recursive: true });
    const added = [];
    for (const source of result.filePaths) {
      const ext = path.extname(source);
      const base = path.basename(source, ext);
      let target = path.join(dir, base + ext);
      for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, base + ' (' + n + ')' + ext);
      fs.copyFileSync(source, target);
      added.push(path.basename(target));
    }
    return { ok: true, added };
  } catch (err) {
    writeLog('rc-exp-add ERROR:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rc-exp-open', async (event, folderName, fileName) => {
  try {
    const target = fileName ? expedienteFile(folderName, fileName) : expedienteDir(folderName);
    if (!fileName) fs.mkdirSync(target, { recursive: true });
    const error = await shell.openPath(target);
    return { ok: !error, error };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// PDF de un documento guardado directamente en el expediente (p. ej. el
// contrato para imprimir y firmar). Si ya existe con ese nombre, se reemplaza.
ipcMain.handle('rc-exp-pdf', async (event, folderName, fileName, datos) => {
  try {
    const opts = datos || {};
    if (!String(opts.bodyHtml || '').trim()) return { ok: false, error: 'sin-contenido' };
    const destino = expedienteFile(folderName, fileName);
    if (path.extname(destino).toLowerCase() !== '.pdf') throw new Error('Archivo no válido.');
    const pdf = await generarPdf(opts, path.basename(destino, '.pdf'));
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(destino, pdf);
    writeLog('PDF en el expediente:', destino);
    return { ok: true, name: path.basename(destino) };
  } catch (err) {
    writeLog('rc-exp-pdf ERROR:', err);
    return { ok: false, error: err.message };
  }
});

// Sube un archivo (el contrato firmado y escaneado: PDF o imagen) al
// expediente con el nombre indicado; si ya había uno igual, lo reemplaza.
ipcMain.handle('rc-exp-subir', async (event, folderName, nombreBase, titulo) => {
  try {
    const dir = expedienteDir(folderName);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: String(titulo || 'Subir archivo'),
      buttonLabel: 'Subir',
      properties: ['openFile'],
      filters: [{ name: 'PDF o imagen escaneada', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'tif', 'tiff'] }, { name: 'Todos los archivos', extensions: ['*'] }]
    });
    if (result.canceled || !result.filePaths.length) return { ok: false, canceled: true };
    const origen = result.filePaths[0];
    const destino = expedienteFile(folderName, String(nombreBase || 'archivo') + path.extname(origen).toLowerCase());
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(origen, destino);
    return { ok: true, name: path.basename(destino) };
  } catch (err) {
    writeLog('rc-exp-subir ERROR:', err);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('rc-exp-trash', async (event, folderName, fileName) => {
  try {
    await shell.trashItem(expedienteFile(folderName, fileName));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------
// Exportar a Excel (.xlsx). El renderer manda las hojas ya armadas;
// aquí se pregunta dónde guardar y se escribe el archivo.
// ---------------------------------------------------------------
let lastExportPath = null;

ipcMain.handle('rc-export-xlsx', async (event, payload) => {
  try {
    const opts = payload || {};
    const info = folderInfo();
    const defaultName = String(opts.defaultName || 'renthouse.xlsx').replace(/[\\/:*?"<>|]+/g, '-');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Exportar a Excel',
      defaultPath: path.join(info.exists ? info.path : app.getPath('documents'), defaultName),
      filters: [{ name: 'Libro de Excel', extensions: ['xlsx'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(result.filePath, buildXlsx(opts.sheets));
    lastExportPath = result.filePath;
    return { ok: true, path: result.filePath, name: path.basename(result.filePath) };
  } catch (err) {
    writeLog('rc-export-xlsx ERROR:', err);
    return { ok: false, error: err.message };
  }
});

// ---------------------------------------------------------------
// Guardar como PDF (recibos, estados de cuenta, documentos del redactor):
// se pregunta dónde guardarlo (por defecto <carpeta de trabajo>/PDF) y se
// genera con una ventana oculta, sin pasar por el navegador.
// ---------------------------------------------------------------
let lastPdfPath = null;

ipcMain.handle('rc-pdf', async (event, payload) => {
  const opts = payload || {};
  if (!String(opts.bodyHtml || '').trim()) return { ok: false, error: 'sin-contenido' };
  const title = String(opts.title || 'documento');
  try {
    const info = folderInfo();
    const carpeta = info.exists ? path.join(info.path, 'PDF') : app.getPath('documents');
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Guardar PDF',
      defaultPath: path.join(carpeta, title.replace(/[\\/:*?"<>|]+/g, '-') + '.pdf'),
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }]
    });
    if (result.canceled || !result.filePath) return { ok: false, canceled: true };
    const pdf = await generarPdf(opts, title);
    fs.mkdirSync(path.dirname(result.filePath), { recursive: true });
    fs.writeFileSync(result.filePath, pdf);
    lastPdfPath = result.filePath;
    writeLog('PDF guardado:', result.filePath);
    return { ok: true, path: result.filePath, name: path.basename(result.filePath) };
  } catch (err) {
    writeLog('rc-pdf ERROR:', err);
    return { ok: false, error: err.message };
  }
});

// PDF de un documento (papel, orientación y márgenes del redactor) con una
// ventana oculta, sin pasar por el navegador.
async function generarPdf(opts, title) {
  const tmp = path.join(os.tmpdir(), 'rc-pdf-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.html');
  let win = null;
  try {
    fs.writeFileSync(tmp, documentoImprimible({ bodyHtml: opts.bodyHtml, pageSize: opts.pageSize || 'Letter', landscape: !!opts.landscape, margen: opts.margen, title, aviso: false }), 'utf8');
    win = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
    await win.loadFile(tmp);
    // La fuente del documento llega por internet: un momento para que se
    // aplique (sin conexión se usa Georgia, como en el editor).
    await new Promise(r => setTimeout(r, 600));
    return await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true });
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    fs.unlink(tmp, () => {});
  }
}

ipcMain.handle('rc-pdf-open', async () => {
  if (!lastPdfPath) return { ok: false };
  const error = await shell.openPath(lastPdfPath);
  return { ok: !error, error };
});

// Solo abre el último archivo exportado, no rutas arbitrarias.
ipcMain.handle('rc-export-open', async () => {
  if (!lastExportPath) return { ok: false };
  const error = await shell.openPath(lastExportPath);
  return { ok: !error, error };
});

// ---------------------------------------------------------------
// Verificación de cédulas con la JCE a través de Didit
// (https://docs.didit.me, servicio "dom_cedula").
//
// - La clave de API se guarda cifrada con safeStorage (DPAPI en
//   Windows) en renthouse-config.json y solo se usa aquí: el renderer
//   nunca la recibe.
// - Las respuestas concluyentes (MATCH / NO_MATCH) se recuerdan en
//   didit-cache.json para no gastar otra consulta con la misma cédula.
// - Se lleva la cuenta de consultas del mes en este equipo (orientativa:
//   la cuenta real la lleva Didit).
// ---------------------------------------------------------------
const DIDIT_URL = 'https://verification.didit.me/v3/database-validation/';
const diditCachePath = path.join(app.getPath('userData'), 'didit-cache.json');

function diditKey() {
  const cifrada = readConfig().diditKey;
  if (!cifrada) return null;
  try {
    return safeStorage.decryptString(Buffer.from(cifrada, 'base64'));
  } catch (err) {
    return null;
  }
}

function leerCacheDidit() {
  try {
    const c = JSON.parse(fs.readFileSync(diditCachePath, 'utf8'));
    return { consultas: c.consultas || {}, uso: c.uso || {} };
  } catch (err) {
    return { consultas: {}, uso: {} };
  }
}

function mesLocal() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

// Didit documenta solo "identification_number" en source_data, pero avisa
// de que los campos dependen del registro: si llega un nombre, se usa.
function datosDePersona(sd) {
  const s = (k) => (typeof sd[k] === 'string' && sd[k] && sd[k] !== 'NO_MATCH' ? sd[k].trim() : '');
  const nombre = s('full_name') || s('name') ||
    [s('first_name') || s('given_names') || s('names'), s('last_name') || s('surnames') || s('surname')].filter(Boolean).join(' ');
  return { nombre, fechaNacimiento: s('date_of_birth') || s('birth_date') };
}

ipcMain.handle('rc-didit-status', () => {
  const cache = leerCacheDidit();
  return { configured: !!diditKey(), usoMes: cache.uso[mesLocal()] || 0, cifradoDisponible: safeStorage.isEncryptionAvailable() };
});

// Envía una consulta a Didit y devuelve { status, json } o { error } si no hay conexión.
async function llamarDidit(key, cedula) {
  const form = new FormData();
  form.append('issuing_state', 'DOM');
  form.append('services', 'dom_cedula');
  form.append('personal_number', cedula);
  try {
    const res = await fetch(DIDIT_URL, { method: 'POST', headers: { 'x-api-key': key }, body: form, signal: AbortSignal.timeout(20000) });
    let json = null;
    try { json = await res.json(); } catch (err) { json = null; }
    return { status: res.status, ok: res.ok, json };
  } catch (err) {
    writeLog('Didit: sin conexión:', err.message);
    return { error: 'No se pudo conectar con Didit. Revisa tu conexión a internet.' };
  }
}

// Mensaje claro para los errores de Didit, con el motivo que da Didit.
function errorDidit(status, json) {
  const detalle = json && (json.detail || json.message || json.error) ? String(json.detail || json.message || json.error).slice(0, 300) : '';
  writeLog('Didit: HTTP', status, detalle);
  if (status === 401) return 'Didit no reconoce la clave de API. Cópiala de nuevo desde su consola.' + (detalle ? ' (' + detalle + ')' : '');
  if (status === 403 && /top-?up/i.test(detalle)) {
    return 'Didit tiene desactivada la verificación de cédulas hasta que recargues saldo por primera vez en tu cuenta (para evitar abusos). Recarga en su consola y vuelve a intentarlo. Para probar gratis, Didit ofrece una aplicación "sandbox".';
  }
  if (status === 403) {
    // Según la ayuda de Didit: entorno equivocado (clave de sandbox o de otra
    // aplicación), clave sin ese permiso, o servicio no activado en la organización.
    return 'Didit reconoce la clave pero no le permite verificar cédulas' + (detalle ? ' ("' + detalle + '")' : '') +
      '. Suele deberse a que la clave es de otra aplicación (por ejemplo, la de pruebas "sandbox" en lugar de la de producción), ' +
      'a que la clave no tiene ese permiso, o a que la validación de bases de datos no está activada en tu organización. ' +
      'Revísalo en la consola de Didit (API & Webhooks) o escríbele a su soporte.';
  }
  if (status === 402) return 'Tu cuenta de Didit no tiene saldo disponible. Recarga en su consola.';
  if (status === 429) return 'Demasiadas consultas seguidas. Espera un momento y vuelve a intentarlo.';
  return 'Didit respondió con un error (' + status + ')' + (detalle ? ': ' + detalle : '.');
}

// Prueba la clave sin gastar consultas: un número con formato inválido
// ("123") no llega al registro; Didit responde 400 si la clave es buena.
ipcMain.handle('rc-didit-test', async () => {
  const key = diditKey();
  if (!key) return { ok: false, error: 'No hay ninguna clave guardada.' };
  const r = await llamarDidit(key, '123');
  if (r.error) return { ok: false, error: r.error };
  if (r.status === 400 || r.status === 422) return { ok: true, mensaje: 'La clave funciona y la verificación de cédulas está activa.' };
  return { ok: false, error: errorDidit(r.status, r.json) };
});

ipcMain.handle('rc-didit-set-key', (event, clave) => {
  // Por si se pega con comillas, "x-api-key:" o "Bearer " delante.
  const key = String(clave || '').trim().replace(/^x-api-key\s*:\s*/i, '').replace(/^bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
  if (key.length < 10) return { ok: false, error: 'La clave parece incompleta. Cópiala entera desde la consola de Didit.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Este equipo no permite guardar la clave cifrada.' };
  const cfg = readConfig();
  cfg.diditKey = safeStorage.encryptString(key).toString('base64');
  writeConfig(cfg);
  return { ok: true };
});

ipcMain.handle('rc-didit-remove-key', () => {
  const cfg = readConfig();
  delete cfg.diditKey;
  writeConfig(cfg);
  return { ok: true };
});

ipcMain.handle('rc-didit-cached', (event, cedula) => {
  const id = String(cedula || '').replace(/\D+/g, '');
  return leerCacheDidit().consultas[id] || null;
});

ipcMain.handle('rc-didit-verify', async (event, cedula) => {
  const id = String(cedula || '').replace(/\D+/g, '');
  if (!/^\d{11}$/.test(id)) return { ok: false, error: 'La cédula debe tener 11 dígitos.' };
  const key = diditKey();
  if (!key) return { ok: false, error: 'sin-clave' };
  const cache = leerCacheDidit();
  if (cache.consultas[id]) return Object.assign({ ok: true, desdeCache: true }, cache.consultas[id]);

  const r = await llamarDidit(key, id);
  if (r.error) return { ok: false, error: r.error };
  if (!r.ok) return { ok: false, error: errorDidit(r.status, r.json) };
  const json = r.json;
  if (!json) return { ok: false, error: 'Didit envió una respuesta inesperada.' };
  const validaciones = Array.isArray(json.validations) ? json.validations : [];
  const v = validaciones.find(x => x.service_id === 'dom_cedula') || validaciones[0] || {};
  const outcome = v.outcome_code || (json.match_type === 'full_match' ? 'MATCH' : json.match_type === 'no_match' ? 'NO_MATCH' : 'DESCONOCIDO');
  const resultado = { outcome, fecha: new Date().toISOString(), datos: datosDePersona(v.source_data || {}) };
  const mes = mesLocal();
  cache.uso[mes] = (cache.uso[mes] || 0) + 1;
  if (outcome === 'MATCH' || outcome === 'NO_MATCH') cache.consultas[id] = resultado;
  try { fs.writeFileSync(diditCachePath, JSON.stringify(cache), 'utf8'); } catch (err) { /* la consulta ya se hizo */ }
  writeLog('Didit: verificación', id.slice(0, 3) + '…', outcome);
  return Object.assign({ ok: true }, resultado);
});

// ---------------------------------------------------------------
// Correo de envío (SMTP) para los recordatorios de pago: la app envía
// cada recordatorio por su cuenta, sin abrir el programa de correo.
// - La contraseña (en Gmail, una "contraseña de aplicación") se guarda
//   cifrada con safeStorage, como la clave de Didit.
// - Un lote se envía con una sola conexión y avisa al renderer de cada
//   envío ('rc-correo-progreso') para mostrar el avance.
// ---------------------------------------------------------------
const nodemailer = require('nodemailer');

function correoConfig() {
  const c = readConfig().correo;
  if (!c || !c.host || !c.user || !c.pass) return null;
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return { host: c.host, port: Number(c.port) || 465, user: c.user, nombre: c.nombre || '', pass: safeStorage.decryptString(Buffer.from(c.pass, 'base64')) };
  } catch (err) {
    return null;
  }
}

function transporteCorreo(c) {
  return nodemailer.createTransport({
    host: c.host, port: c.port, secure: c.port === 465,
    auth: { user: c.user, pass: c.pass },
    connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000
  });
}

// Mensaje claro para los errores de SMTP más comunes.
function errorCorreo(err) {
  writeLog('Correo:', err && (err.code || ''), err && err.message);
  const code = err && err.code;
  if (code === 'EAUTH') return 'El servidor no aceptó el usuario o la contraseña. En Gmail usa una contraseña de aplicación, no la de tu cuenta.';
  if (code === 'EDNS' || code === 'ECONNECTION' || code === 'ETIMEDOUT' || code === 'ESOCKET' || code === 'ECONNREFUSED') return 'No se pudo conectar con el servidor de correo. Revisa tu conexión a internet, el servidor y el puerto.';
  if (code === 'EENVELOPE') return 'El servidor rechazó la dirección de destino.';
  return 'No se pudo enviar: ' + ((err && err.message) || 'error desconocido') + '.';
}

function remitente(c) {
  return c.nombre ? { name: c.nombre, address: c.user } : c.user;
}

ipcMain.handle('rc-correo-status', () => {
  const guardado = readConfig().correo || {};
  return { configured: !!correoConfig(), host: guardado.host || '', port: guardado.port || 465, user: guardado.user || '', nombre: guardado.nombre || '', cifradoDisponible: safeStorage.isEncryptionAvailable() };
});

// Guarda la cuenta; si no se escribe contraseña, se conserva la anterior.
ipcMain.handle('rc-correo-set', (event, datos) => {
  const d = datos || {};
  const host = String(d.host || '').trim().toLowerCase();
  const port = Number(d.port);
  const user = String(d.user || '').trim();
  const pass = String(d.pass || '').replace(/\s+/g, ''); // Gmail la muestra en grupos de 4 con espacios
  if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(host)) return { ok: false, error: 'Revisa el servidor de correo (p. ej. smtp.gmail.com).' };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, error: 'El puerto no es válido.' };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return { ok: false, error: 'Escribe tu dirección de correo completa.' };
  const anterior = readConfig().correo || {};
  if (!pass && !anterior.pass) return { ok: false, error: 'Falta la contraseña.' };
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'Este equipo no permite guardar la contraseña cifrada.' };
  const cfg = readConfig();
  cfg.correo = { host, port, user, nombre: String(d.nombre || '').trim().slice(0, 80), pass: pass ? safeStorage.encryptString(pass).toString('base64') : anterior.pass };
  writeConfig(cfg);
  return { ok: true };
});

ipcMain.handle('rc-correo-remove', () => {
  const cfg = readConfig();
  delete cfg.correo;
  writeConfig(cfg);
  return { ok: true };
});

// Se envía un correo de prueba a la propia cuenta.
ipcMain.handle('rc-correo-test', async () => {
  const c = correoConfig();
  if (!c) return { ok: false, error: 'sin-configurar' };
  const t = transporteCorreo(c);
  try {
    await t.sendMail({ from: remitente(c), to: c.user, subject: 'Prueba de RentHouse', text: 'Si lees esto, los recordatorios de pago por correo funcionan.' });
    return { ok: true, mensaje: 'Funciona: te enviamos un correo de prueba a ' + c.user + '.' };
  } catch (err) {
    return { ok: false, error: errorCorreo(err) };
  } finally {
    t.close();
  }
});

// mensajes: [{ id, to, subject, text }] → [{ id, ok, error }]
ipcMain.handle('rc-correo-enviar-lote', async (event, mensajes) => {
  const c = correoConfig();
  if (!c) return { ok: false, error: 'sin-configurar' };
  const lista = (Array.isArray(mensajes) ? mensajes : []).slice(0, 500);
  const t = transporteCorreo(c);
  const resultados = [];
  try {
    for (let i = 0; i < lista.length; i++) {
      const m = lista[i] || {};
      let r;
      if (!/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(String(m.to || ''))) r = { id: m.id, ok: false, error: 'Dirección de correo no válida.' };
      else {
        try {
          await t.sendMail({ from: remitente(c), replyTo: c.user, to: String(m.to), subject: String(m.subject || '').slice(0, 200), text: String(m.text || '') });
          r = { id: m.id, ok: true };
        } catch (err) {
          r = { id: m.id, ok: false, error: errorCorreo(err) };
          // Sin conexión o sin acceso fallarán todos: se corta el lote.
          if (['EAUTH', 'EDNS', 'ECONNECTION', 'ETIMEDOUT', 'ECONNREFUSED'].includes(err && err.code)) {
            resultados.push(r);
            if (!event.sender.isDestroyed()) event.sender.send('rc-correo-progreso', { hecho: i + 1, total: lista.length, resultado: r });
            return { ok: false, error: r.error, resultados };
          }
        }
      }
      resultados.push(r);
      if (!event.sender.isDestroyed()) event.sender.send('rc-correo-progreso', { hecho: i + 1, total: lista.length, resultado: r });
    }
    writeLog('Correo: lote enviado,', resultados.filter(r => r.ok).length, 'de', lista.length);
    return { ok: true, resultados };
  } finally {
    t.close();
  }
});

// ---------------------------------------------------------------
// Licencias: el servidor (servidor-licencias/worker.js) devuelve un
// token { k: clave, d: equipo, p: plan, t: fecha } firmado con Ed25519.
// Aquí se comprueba con la clave pública que viaja con la app, así nadie
// puede cambiarse el plan editando lo guardado en su equipo. maxEdadMs
// limita cuánto vale un token guardado cuando no hay internet.
// ---------------------------------------------------------------
const PLANES_LICENCIA = ['completo', 'redactor'];
function clavePublicaLicencia() {
  // Los tests usan su propia clave; la app instalada, siempre la suya.
  if (!app.isPackaged && process.env.RC_LICENCIA_CLAVE_PUBLICA) return process.env.RC_LICENCIA_CLAVE_PUBLICA;
  try { return fs.readFileSync(path.join(__dirname, 'licencia-publica.pem'), 'utf8'); } catch (err) { return null; }
}

ipcMain.handle('rc-licencia-verificar', (event, datos) => {
  const d = datos || {};
  const publica = clavePublicaLicencia();
  if (!publica) return { ok: false, error: 'sin-clave-publica' };
  try {
    const [cuerpo, firma] = String(d.token || '').split('.');
    if (!cuerpo || !firma) return { ok: false, error: 'token-invalido' };
    const bytes = Buffer.from(cuerpo, 'base64url');
    if (!crypto.verify(null, bytes, publica, Buffer.from(firma, 'base64url'))) return { ok: false, error: 'firma-invalida' };
    const t = JSON.parse(bytes.toString('utf8'));
    if (t.k !== d.licenseKey || t.d !== d.deviceId || !PLANES_LICENCIA.includes(t.p)) return { ok: false, error: 'token-ajeno' };
    const edad = Date.now() - Number(t.t);
    if (!(edad > -5 * 60 * 1000)) return { ok: false, error: 'token-futuro' };
    if (d.maxEdadMs && edad > d.maxEdadMs) return { ok: false, error: 'token-caducado', edadMs: edad };
    return { ok: true, plan: t.p, edadMs: edad };
  } catch (err) {
    writeLog('Licencia: token no válido:', err.message);
    return { ok: false, error: 'token-invalido' };
  }
});

ipcMain.on('rc-licencia-registro', (event, texto) => writeLog(String(texto).slice(0, 200)));

ipcMain.on('rc-app-version', (event) => {
  event.returnValue = app.getVersion();
});

ipcMain.handle('rc-folder-open', async () => {
  const info = folderInfo();
  if (!info.exists) return { ok: false, error: 'sin-carpeta' };
  const error = await shell.openPath(info.path);
  return { ok: !error, error };
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
      sandbox: false,
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
    // Solo en desarrollo: en la app instalada abrirían la puerta a saltarse la licencia.
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') {
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
    // mailto: abre el programa de correo (recordatorios de pago).
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('mailto:')) {
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
  // Índice del listado DGII de versiones anteriores (la función se quitó).
  fs.rm(path.join(app.getPath('userData'), 'dgii'), { recursive: true, force: true }, () => {});
  runDailyBackup();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});