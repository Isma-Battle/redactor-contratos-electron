// ---------------------------------------------------------------
// Escritor mínimo de archivos .xlsx (Excel), sin dependencias.
//
// Un .xlsx es un ZIP con varios XML. Aquí se arma con el método
// "store" (sin compresión), que Excel abre sin problema, y celdas con
// texto en línea, así que no hace falta tabla de cadenas compartidas.
//
// buildXlsx([{ name, columns: [{ header, type, width }], rows: [[...]] }])
//   type: 'text' (por defecto) | 'number' | 'money' | 'date'
//   'date' espera 'AAAA-MM-DD' y se guarda como fecha real de Excel.
// Devuelve un Buffer con el archivo.
// ---------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

// ZIP sin compresión. files: [{ name, data: Buffer|string }]
function zipStore(files) {
  const { time, day } = dosDateTime(new Date());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, 'utf8');
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);       // versión necesaria
    local.writeUInt16LE(0x0800, 6);   // nombres en UTF-8
    local.writeUInt16LE(0, 8);        // sin compresión
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + data.length;
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function xmlEscape(value) {
  return String(value)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function columnLetter(index) {
  let s = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

// Días desde el 30/12/1899, como cuenta Excel las fechas.
function excelDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  if (!m) return null;
  return Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000);
}

// Estilos: 0 normal, 1 encabezado (negrita con fondo), 2 moneda, 3 fecha.
const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="2"><numFmt numFmtId="164" formatCode="#,##0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
  '<fill><patternFill patternType="solid"><fgColor rgb="FFDCE6F7"/><bgColor indexed="64"/></patternFill></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  '</styleSheet>';

function cellXml(ref, value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'money' || type === 'number') {
    const n = Number(value);
    if (Number.isFinite(n)) return '<c r="' + ref + '"' + (type === 'money' ? ' s="2"' : '') + '><v>' + n + '</v></c>';
  }
  if (type === 'date') {
    const serial = excelDate(value);
    if (serial !== null) return '<c r="' + ref + '" s="3"><v>' + serial + '</v></c>';
  }
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(value) + '</t></is></c>';
}

function sheetXml(sheet) {
  const columns = sheet.columns || [];
  const rows = sheet.rows || [];
  const lastCol = columnLetter(Math.max(columns.length, 1) - 1);
  const cols = '<cols>' + columns.map((c, i) =>
    '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (c.width || 16) + '" customWidth="1"/>').join('') + '</cols>';
  const header = '<row r="1">' + columns.map((c, i) =>
    '<c r="' + columnLetter(i) + '1" t="inlineStr" s="1"><is><t xml:space="preserve">' + xmlEscape(c.header) + '</t></is></c>').join('') + '</row>';
  const body = rows.map((row, r) => '<row r="' + (r + 2) + '">' +
    row.map((value, i) => cellXml(columnLetter(i) + (r + 2), value, (columns[i] || {}).type)).join('') + '</row>').join('');
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    cols + '<sheetData>' + header + body + '</sheetData>' +
    (rows.length ? '<autoFilter ref="A1:' + lastCol + (rows.length + 1) + '"/>' : '') +
    '</worksheet>';
}

// Excel no admite ciertos caracteres ni más de 31 en el nombre de la hoja.
function safeSheetName(name, used) {
  let base = String(name || 'Hoja').replace(/[\[\]:*?\/\\]/g, ' ').trim().slice(0, 31) || 'Hoja';
  let candidate = base;
  for (let n = 2; used.has(candidate.toLowerCase()); n++) candidate = base.slice(0, 28) + ' ' + n;
  used.add(candidate.toLowerCase());
  return candidate;
}

function buildXlsx(sheets) {
  if (!Array.isArray(sheets) || !sheets.length) throw new Error('No hay hojas que exportar.');
  const used = new Set();
  const names = sheets.map(s => safeSheetName(s.name, used));
  const files = [
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      names.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
      '</Types>' },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + names.map((n, i) => '<sheet name="' + xmlEscape(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets>' +
      '</workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      names.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') +
      '<Relationship Id="rId' + (names.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>' },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...sheets.map((s, i) => ({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: sheetXml(s) }))
  ];
  return zipStore(files);
}

module.exports = { buildXlsx };
