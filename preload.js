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

const { contextBridge, ipcRenderer, webFrame } = require('electron');

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
  print: (payload) => ipcRenderer.invoke('rc-print', payload),
  // Mismo payload; pregunta dónde guardar. Devuelve { ok, path, name } o { ok:false, canceled|error }.
  pdf: (payload) => ipcRenderer.invoke('rc-pdf', payload),
  openLastPdf: () => ipcRenderer.invoke('rc-pdf-open')
});

// Carpeta de trabajo del redactor (documentos .doc y subcarpeta Modelos).
// kind es 'documento' o 'modelo'; name, solo el nombre del archivo.
contextBridge.exposeInMainWorld('rcFiles', {
  getFolder: () => ipcRenderer.invoke('rc-folder-get'),
  chooseFolder: () => ipcRenderer.invoke('rc-folder-choose'),
  openFolder: () => ipcRenderer.invoke('rc-folder-open'),
  list: () => ipcRenderer.invoke('rc-folder-list'),
  read: (kind, name) => ipcRenderer.invoke('rc-folder-read', kind, name),
  write: (kind, name, text, overwrite) => ipcRenderer.invoke('rc-folder-write', kind, name, text, !!overwrite),
  trash: (kind, name) => ipcRenderer.invoke('rc-folder-trash', kind, name)
});

// Expedientes de inquilinos: archivos en <carpeta de trabajo>/Expedientes/<folder>.
contextBridge.exposeInMainWorld('rcExpediente', {
  list: (folder) => ipcRenderer.invoke('rc-exp-list', folder),
  add: (folder) => ipcRenderer.invoke('rc-exp-add', folder),
  open: (folder, name) => ipcRenderer.invoke('rc-exp-open', folder, name || null),
  trash: (folder, name) => ipcRenderer.invoke('rc-exp-trash', folder, name)
});

// Exportar a Excel: sheets = [{ name, columns: [{ header, type, width }], rows }].
contextBridge.exposeInMainWorld('rcExport', {
  xlsx: (defaultName, sheets) => ipcRenderer.invoke('rc-export-xlsx', { defaultName, sheets }),
  openLast: () => ipcRenderer.invoke('rc-export-open')
});

// Verificación de cédulas con la JCE vía Didit. La clave de API no pasa
// por aquí salvo al guardarla: se queda cifrada en el proceso principal.
contextBridge.exposeInMainWorld('rcDidit', {
  status: () => ipcRenderer.invoke('rc-didit-status'),
  setKey: (clave) => ipcRenderer.invoke('rc-didit-set-key', clave),
  removeKey: () => ipcRenderer.invoke('rc-didit-remove-key'),
  // Comprueba la clave sin gastar consultas: { ok, mensaje } o { ok:false, error }.
  test: () => ipcRenderer.invoke('rc-didit-test'),
  // Resultado guardado de una verificación anterior (o null).
  cached: (cedula) => ipcRenderer.invoke('rc-didit-cached', cedula),
  // { ok, outcome: 'MATCH'|'NO_MATCH'|..., fecha, datos: { nombre, fechaNacimiento }, desdeCache } o { ok:false, error }
  verify: (cedula) => ipcRenderer.invoke('rc-didit-verify', cedula)
});

// Correo de envío (SMTP) para los recordatorios. La contraseña no vuelve
// al renderer: solo se manda al guardarla.
contextBridge.exposeInMainWorld('rcCorreo', {
  status: () => ipcRenderer.invoke('rc-correo-status'),
  set: (datos) => ipcRenderer.invoke('rc-correo-set', datos),
  remove: () => ipcRenderer.invoke('rc-correo-remove'),
  test: () => ipcRenderer.invoke('rc-correo-test'),
  // mensajes: [{ id, to, subject, text }]; alProgreso({ hecho, total, resultado }) por cada envío.
  enviarLote: async (mensajes, alProgreso) => {
    const oyente = (_e, p) => { if (alProgreso) alProgreso(p); };
    ipcRenderer.on('rc-correo-progreso', oyente);
    try { return await ipcRenderer.invoke('rc-correo-enviar-lote', mensajes); }
    finally { ipcRenderer.removeListener('rc-correo-progreso', oyente); }
  }
});

// Comprueba el token firmado del servidor de licencias:
// { ok, plan: 'completo'|'redactor' } o { ok:false, error }.
contextBridge.exposeInMainWorld('rcLicencia', {
  verificar: (datos) => ipcRenderer.invoke('rc-licencia-verificar', datos),
  // Deja constancia en debug.log de por qué no se activó (para diagnosticar).
  registrar: (texto) => ipcRenderer.send('rc-licencia-registro', String(texto).slice(0, 200))
});

contextBridge.exposeInMainWorld('rcApp', {
  version: ipcRenderer.sendSync('rc-app-version'),
  // Tamaño de la interfaz (Configuración → Apariencia), como el zoom del navegador.
  setZoom: (factor) => webFrame.setZoomFactor(Math.min(1.5, Math.max(0.75, Number(factor) || 1)))
});

// Respaldo automático diario de los datos (lo hace main.js al guardar).
contextBridge.exposeInMainWorld('rcBackup', {
  // { dir, inWorkFolder, count, keep, last: { name, mtime } | null }
  status: () => ipcRenderer.invoke('rc-backup-status'),
  open: () => ipcRenderer.invoke('rc-backup-open')
});

// Datos de gestión (edificios, apartamentos, inquilinos, contratos),
// guardados por main.js en un archivo JSON de la carpeta de datos de la app.
contextBridge.exposeInMainWorld('rcData', {
  // Devuelve { ok: true, data } (data es null si aún no hay nada guardado)
  // o { ok: false, error }.
  load: () => ipcRenderer.invoke('rc-data-load'),
  // Devuelve { ok: true } o { ok: false, error }.
  save: (data) => ipcRenderer.invoke('rc-data-save', data)
});