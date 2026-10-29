// ---------------------------------------------------------------
// Prueba de extremo a extremo de RentHouse.
//
//   npm run test:e2e
//
// Arranca el main.js real con una carpeta de datos y una carpeta de
// trabajo temporales (no toca tus datos), sin mostrar la ventana, y
// recorre la aplicación con clics simulados (pasos.js). Todo lo que
// saldría de la aplicación se intercepta: impresión, diálogos de
// archivos, WhatsApp/correo. Termina con código 1 si algo falla.
//
// Nota: si la terminal tiene ELECTRON_RUN_AS_NODE=1 (por ejemplo, la de
// algunos editores), quítala antes:  set ELECTRON_RUN_AS_NODE=
// ---------------------------------------------------------------
const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

const PROJECT = path.join(__dirname, '..', '..');
const TMP = path.join(os.tmpdir(), 'renthouse-e2e');
const userData = path.join(TMP, 'userdata');
const workDir = path.join(TMP, 'trabajo');
const fixtures = path.join(TMP, 'fixtures');

fs.rmSync(TMP, { recursive: true, force: true });
[userData, workDir, fixtures].forEach(d => fs.mkdirSync(d, { recursive: true }));
app.setPath('userData', userData);
// La carpeta de trabajo ya "elegida" (el diálogo no se puede usar aquí).
fs.writeFileSync(path.join(userData, 'renthouse-config.json'), JSON.stringify({ workFolder: workDir }));
fs.writeFileSync(path.join(fixtures, 'cedula-escaneada.txt'), 'archivo de prueba');
// Índice del listado DGII que dejaron versiones anteriores: se borra al iniciar.
fs.mkdirSync(path.join(userData, 'dgii'), { recursive: true });
fs.writeFileSync(path.join(userData, 'dgii', 'info.json'), '{}');

BrowserWindow.prototype.show = function () {};
BrowserWindow.prototype.maximize = function () {};

const results = [];
const check = (label, ok) => results.push((ok ? 'OK   ' : 'FALLA') + ' ' + label);
const errors = [];

let ventanaPrincipal = null;
app.on('browser-window-created', (_e, win) => {
  if (ventanaPrincipal) return; // p. ej. la ventana oculta que genera los PDF
  ventanaPrincipal = win;
  win.webContents.on('console-message', (_ev, level, message, line, source) => {
    if (level >= 2 && !/Security Warning/.test(message)) errors.push(`[consola] ${message} (${source}:${line})`);
  });
  win.webContents.once('did-finish-load', async () => {
    try {
      const steps = fs.readFileSync(path.join(__dirname, 'pasos.js'), 'utf8');
      const result = await win.webContents.executeJavaScript('window.__TOKENS = ' + JSON.stringify(tokensLicencia) + ';\n' + steps);
      results.push(...result.log);
    } catch (err) {
      check('los pasos terminan sin excepción (' + (err && err.message ? err.message : err) + ')', false);
    }
    // Si los pasos se cortaron, faltarán archivos: que eso no oculte los resultados.
    try { verificarArchivos(); } catch (err) { check('comprobación de archivos (' + err.message + ')', false); }
    finalizar();
  });
});

// Servidor de correo simulado: nodemailer no sale a internet; la contraseña
// "malamala" se rechaza como en Gmail y lo enviado se guarda para comprobarlo.
// Licencias: clave de firma de prueba (la app la usa en vez de licencia-publica.pem
// porque no está empaquetada) y tokens como los que daría el Worker.
const claveLicencia = require('crypto').generateKeyPairSync('ed25519');
process.env.RC_LICENCIA_CLAVE_PUBLICA = claveLicencia.publicKey.export({ type: 'spki', format: 'pem' });
const firmarLicencia = (datos) => {
  const bytes = Buffer.from(JSON.stringify(datos));
  return bytes.toString('base64url') + '.' + require('crypto').sign(null, bytes, claveLicencia.privateKey).toString('base64url');
};
const tokensLicencia = {
  redactor: firmarLicencia({ k: 'CLAVE-RED', d: 'equipo-prueba', p: 'redactor', t: Date.now() }),
  completo: firmarLicencia({ k: 'CLAVE-COMP', d: 'equipo-prueba', p: 'completo', t: Date.now() }),
  viejo: firmarLicencia({ k: 'CLAVE-RED', d: 'equipo-prueba', p: 'redactor', t: Date.now() - 13 * 3600 * 1000 }),
  ajeno: firmarLicencia({ k: 'CLAVE-RED', d: 'otro-equipo', p: 'completo', t: Date.now() })
};

const correosEnviados = [];
const rutaNodemailer = require.resolve('nodemailer', { paths: [PROJECT] });
require.cache[rutaNodemailer] = { id: rutaNodemailer, filename: rutaNodemailer, loaded: true, exports: {
  createTransport: (opts) => ({
    sendMail: async (m) => {
      if (opts.auth.pass === 'malamala') { const e = new Error('Invalid login'); e.code = 'EAUTH'; throw e; }
      correosEnviados.push(Object.assign({ servidor: opts.host + ':' + opts.port, seguro: opts.secure }, m));
      return { messageId: 'simulado' };
    },
    close() {}
  })
} };

require(path.join(PROJECT, 'main.js'));

// ---------- Lo que saldría de la aplicación ----------
const printed = [];
ipcMain.removeHandler('rc-print');
ipcMain.handle('rc-print', (_e, payload) => { printed.push(payload); return { success: true }; });

const opened = [];
shell.openExternal = async (url) => { opened.push(url); };

// Didit simulado (no se llama al servicio real): responde según la clave
// y la cédula, y guarda cada llamada para comprobarla al final.
const llamadasDidit = [];
globalThis.fetch = async (url, opts) => {
  const llamada = { url: String(url), clave: opts.headers['x-api-key'], cedula: opts.body.get('personal_number'), servicio: opts.body.get('services'), pais: opts.body.get('issuing_state') };
  llamadasDidit.push(llamada);
  const responder = (status, cuerpo) => ({ status, ok: status >= 200 && status < 300, json: async () => cuerpo });
  if (llamada.clave === 'clave-mala-123') return responder(401, { detail: 'Invalid API key' });
  // Respuesta real de Didit cuando la cuenta aún no ha recargado saldo.
  if (llamada.clave === 'clave-sin-saldo-123') return responder(403, { detail: "To protect against abuse, database validation is disabled until your organization's first top-up. You can still test it for free on a sandbox application." });
  if (llamada.clave === 'clave-sin-permiso-123') return responder(403, { detail: 'You do not have permission to perform this action.' });
  if (llamada.cedula === '123') return responder(400, { personal_number: ['Must be exactly 11 digits.'] });
  if (llamada.cedula === '00100000009') {
    return responder(200, { request_id: 'req_1', status: 'Approved', issuing_state: 'DOM', match_type: 'full_match',
      validations: [{ outcome_code: 'MATCH', service_id: 'dom_cedula', source_data: { identification_number: '00100000009', full_name: 'PEDRO PABLO GOMEZ' }, validation: { identification_number: 'full_match' } }] });
  }
  return responder(200, { request_id: 'req_2', status: 'Declined', issuing_state: 'DOM', match_type: 'no_match',
    validations: [{ outcome_code: 'NO_MATCH', service_id: 'dom_cedula', source_data: { identification_number: 'NO_MATCH' }, validation: { identification_number: 'no_match' } }] });
};

// "Guardar PDF" guarda en la carpeta temporal sin preguntar.
const { dialog } = require('electron');
const guardarOriginal = dialog.showSaveDialog.bind(dialog);
const pdfsGuardados = [];
dialog.showSaveDialog = async (win, opts) => {
  if (opts && opts.title === 'Guardar PDF') {
    const destino = path.join(TMP, 'pdf', path.basename(opts.defaultPath));
    pdfsGuardados.push({ destino, defaultPath: opts.defaultPath });
    return { canceled: false, filePath: destino };
  }
  return guardarOriginal(win, opts);
};

const { buildXlsx } = require(path.join(PROJECT, 'xlsx-writer'));
const xlsxPath = path.join(TMP, 'export.xlsx');
ipcMain.removeHandler('rc-export-xlsx');
ipcMain.handle('rc-export-xlsx', (_e, payload) => {
  fs.writeFileSync(xlsxPath, buildXlsx(payload.sheets));
  return { ok: true, path: xlsxPath, name: path.basename(xlsxPath), sheets: payload.sheets.map(s => s.name) };
});

// "Subir contrato firmado": se elige un PDF escaneado de prueba.
fs.writeFileSync(path.join(fixtures, 'escaneo firmado.pdf'), '%PDF-1.4\n% contrato firmado de prueba\n');
const abrirOriginal = dialog.showOpenDialog.bind(dialog);
dialog.showOpenDialog = async (win, opts) => {
  if (opts && opts.title === 'Contrato firmado escaneado') return { canceled: false, filePaths: [path.join(fixtures, 'escaneo firmado.pdf')] };
  return abrirOriginal(win, opts);
};
// Abrir un archivo (PDF del contrato, firmado...) no abre nada: se anota.
const archivosAbiertos = [];
shell.openPath = async (p) => { archivosAbiertos.push(p); return ''; };

ipcMain.removeHandler('rc-exp-add');
ipcMain.handle('rc-exp-add', (_e, folder) => {
  const dir = path.join(workDir, 'Expedientes', folder);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(fixtures, 'cedula-escaneada.txt'), path.join(dir, 'cedula-escaneada.txt'));
  return { ok: true, added: ['cedula-escaneada.txt'] };
});

// ---------- Comprobaciones de los archivos generados ----------
function listar(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => fs.statSync(path.join(dir, n)).isFile()) : [];
}

function verificarArchivos() {
  const datos = JSON.parse(fs.readFileSync(path.join(userData, 'renthouse-datos.json'), 'utf8'));
  check('archivo de datos con su copia .bak', fs.existsSync(path.join(userData, 'renthouse-datos.json.bak')));
  check('datos guardados (propietarios, pagos, liquidaciones)', datos.propietarios.length === 2 && datos.pagos.length > 3 && Array.isArray(datos.liquidaciones));
  check('documento del contrato guardado', datos.contratos.some(c => c.documentoHtml));
  check('respaldo automático del día en la carpeta de trabajo', listar(path.join(workDir, 'Respaldos')).some(n => /^renthouse-respaldo-\d{4}-\d{2}-\d{2}\.json$/.test(n)));
  check('.doc guardado en la carpeta de trabajo', listar(workDir).some(n => n.endsWith('.doc')));
  const pdfRecibo = pdfsGuardados.find(p => /Recibo_/.test(p.destino));
  check('recibo en PDF: archivo PDF válido, propuesto en <carpeta de trabajo>/PDF', !!pdfRecibo && fs.existsSync(pdfRecibo.destino) &&
    fs.readFileSync(pdfRecibo.destino).slice(0, 5).toString() === '%PDF-' && path.dirname(pdfRecibo.defaultPath) === path.join(workDir, 'PDF'));
  const acta = printed.find(p => p.bodyHtml.includes('ACTA DE DEVOLUCIÓN DEL INMUEBLE'));
  check('acta de devolución imprimible: compara con la entrega, lecturas, fotos y firmas', !!acta && ['Al entregar', 'Regular', 'Malo', 'Lámpara de techo', 'cedula-escaneada.txt', 'Inquilino'].every(x => acta.bodyHtml.includes(x)));
  const datosFinal = JSON.parse(fs.readFileSync(path.join(userData, 'renthouse-datos.json'), 'utf8'));
  check('actas y reparaciones guardadas en los datos', datosFinal.actas.length === 2 && datosFinal.reparaciones.length === 1 && datosFinal.reparaciones[0].gastoId);
  const configJson = JSON.parse(fs.readFileSync(path.join(userData, 'renthouse-config.json'), 'utf8'));
  check('la contraseña del correo se guarda cifrada', !!configJson.correo && configJson.correo.user === 'despacho@gmail.com' && !JSON.stringify(configJson).includes('abcdefghijklmnop'));
  const prueba = correosEnviados.find(m => m.subject === 'Prueba de RentHouse');
  check('correo de prueba a la propia cuenta, por Gmail (465, SSL)', !!prueba && prueba.to === 'despacho@gmail.com' && prueba.servidor === 'smtp.gmail.com:465' && prueba.seguro === true);
  const recordatorio = correosEnviados.find(m => m.to === 'inquilino@ejemplo.com');
  check('recordatorio por correo automático, personalizado', !!recordatorio && recordatorio.subject === 'Recordatorio de pago de alquiler' && /debe|pendiente|adeud/i.test(recordatorio.text) &&
    correosEnviados.filter(m => m.to === 'inquilino@ejemplo.com').length === new Set(correosEnviados.filter(m => m.to === 'inquilino@ejemplo.com').map(m => m.text)).size);
  const pdfPaginas = pdfsGuardados.find(p => /paginas_\d+\.pdf$/.test(p.destino));
  const paginasPdf = pdfPaginas && fs.existsSync(pdfPaginas.destino) ? (fs.readFileSync(pdfPaginas.destino, 'latin1').match(/\/Type\s*\/Page[^s]/g) || []).length : 0;
  check('el PDF tiene las mismas páginas que las hojas del editor (' + paginasPdf + ')', !!pdfPaginas && paginasPdf === Number(pdfPaginas.destino.match(/paginas_(\d+)\.pdf$/)[1]));
  check('PDF del redactor guardado', pdfsGuardados.some(p => /\.pdf$/.test(p.destino) && !/Recibo_/.test(p.destino) && fs.existsSync(p.destino)));
  check('modelos en la subcarpeta Modelos', listar(path.join(workDir, 'Modelos')).length === 2);
  const exp = fs.existsSync(path.join(workDir, 'Expedientes')) ? fs.readdirSync(path.join(workDir, 'Expedientes')) : [];
  check('carpeta de expediente con el archivo adjunto', exp.length === 1 && listar(path.join(workDir, 'Expedientes', exp[0])).includes('cedula-escaneada.txt'));
  const archivosExp = exp.length ? listar(path.join(workDir, 'Expedientes', exp[0])) : [];
  const pdfContrato = archivosExp.find(n => /^Contrato - .+\.pdf$/.test(n) && !n.includes('(firmado)'));
  const firmado = archivosExp.find(n => /^Contrato - .+ \(firmado\)\.pdf$/.test(n));
  check('PDF del contrato en el expediente (' + pdfContrato + ')', !!pdfContrato && fs.readFileSync(path.join(workDir, 'Expedientes', exp[0], pdfContrato)).slice(0, 4).toString() === '%PDF');
  check('contrato firmado en el expediente con su nombre (' + firmado + ')', !!firmado && fs.readFileSync(path.join(workDir, 'Expedientes', exp[0], firmado), 'utf8').includes('contrato firmado de prueba'));
  check('"Firmado ✓" y "Contrato en PDF" abren sus archivos', archivosAbiertos.some(p => p.endsWith('(firmado).pdf')) && archivosAbiertos.some(p => p.endsWith(pdfContrato || '?')));
  check('el contrato guarda los nombres de sus archivos', datos.contratos.some(c => c.firmado && c.firmado.archivo === firmado && c.pdfArchivo === pdfContrato));

  const ultimoRecibo = printed.filter(p => p.bodyHtml.includes('RECIBO DE PAGO')).pop();
  check('recibo con el despacho y el papel de la configuración', !!ultimoRecibo && ultimoRecibo.bodyHtml.includes('Administrado por Bufete Prueba SRL · Tel. 809-555-0000') && ultimoRecibo.pageSize === 'A4');
  check('los ajustes se guardan con los datos', datos.ajustes && datos.ajustes.moneda === 'US$' && datos.ajustes.diaPago === 5 && datos.ajustes.despacho === 'Bufete Prueba SRL');
  const config = fs.readFileSync(path.join(userData, 'renthouse-config.json'), 'utf8');
  check('la clave de Didit se guarda cifrada (no en texto plano)', config.includes('diditKey') && !config.includes('clave-buena') && !config.includes('clave-mala'));
  const consultasCedula = llamadasDidit.filter(l => /^\d{11}$/.test(l.cedula));
  check('Didit: 3 consultas de cédula (clave mala, MATCH, NO_MATCH); la ya verificada no se repite', consultasCedula.length === 3 &&
    llamadasDidit.every(l => l.url === 'https://verification.didit.me/v3/database-validation/' && l.servicio === 'dom_cedula' && l.pais === 'DOM'));
  check('Didit: "Probar clave" usa un número inválido, que no se cobra', llamadasDidit.filter(l => l.cedula === '123').length >= 3);
  const cacheDidit = JSON.parse(fs.readFileSync(path.join(userData, 'didit-cache.json'), 'utf8'));
  check('Didit: guarda solo los resultados concluyentes', Object.keys(cacheDidit.consultas).length === 2 && cacheDidit.consultas['00100000009'].outcome === 'MATCH');
  check('borra el índice del listado DGII de versiones anteriores', !fs.existsSync(path.join(userData, 'dgii')));
  const recibo = printed.find(p => p.bodyHtml.includes('RECIBO DE PAGO'));
  check('recibo con sus datos', !!recibo && ['Juan Pérez', '001-1234567-3', 'RD$ 25,000.00', 'TRX-001', 'María Gómez'].every(s => recibo.bodyHtml.includes(s)) && recibo.pageSize === 'Letter');
  const reciboVarios = printed.find(p => p.bodyHtml.includes('RECIBO DE PAGO') && p.bodyHtml.includes('los meses de'));
  check('recibo de un pago de varios meses', !!reciboVarios && ['enero 2026, febrero 2026 y marzo 2026', 'RD$ 75,000.00', 'TRX-3MESES'].every(s => reciboVarios.bodyHtml.includes(s)));
  const ecProp = printed.find(p => p.bodyHtml.includes('LIQUIDACIÓN</div>'));
  check('liquidación del edificio', !!ecProp && ['Residencial Las Palmas', 'María Gómez', 'Comisión por apartamento', '10% de lo cobrado', 'Comisión del abogado', '123-456789-0', '28,000.00', 'Saldo a favor del propietario'].every(s => ecProp.bodyHtml.includes(s)) && !ecProp.bodyHtml.includes('llave'));
  const ecInq = printed.find(p => p.bodyHtml.includes('ESTADO DE CUENTA DEL INQUILINO'));
  check('estado de cuenta del inquilino', !!ecInq && ['Juan Pérez', 'Ana Rodríguez', 'Luis Fiador', '10% de la cuota', 'Deuda vencida'].every(s => ecInq.bodyHtml.includes(s)));

  check('WhatsApp con el número y el mensaje', opened.some(u => u.startsWith('https://wa.me/18095551234?text=') && decodeURIComponent(u).includes('Juan Pérez')));
  const xlsx = fs.existsSync(xlsxPath) ? fs.readFileSync(xlsxPath) : null;
  check('Excel exportado (.xlsx válido)', !!xlsx && xlsx.slice(0, 2).toString() === 'PK' && xlsx.includes(Buffer.from('Morosidad')) && xlsx.includes(Buffer.from('Liquidaciones')));
}

function finalizar() {
  if (errors.length) results.push(...errors.map(e => 'FALLA ' + e));
  console.log(results.join('\n'));
  const fallas = results.filter(r => r.startsWith('FALLA')).length;
  const oks = results.filter(r => r.startsWith('OK')).length;
  console.log('\n' + oks + ' correctas, ' + fallas + ' fallidas.');
  app.exit(fallas ? 1 : 0);
}
