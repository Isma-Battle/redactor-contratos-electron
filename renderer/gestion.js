(function(){
  // ---------------------------------------------------------------
  // Gestión de alquileres: edificios, apartamentos, inquilinos y
  // contratos, con un menú lateral para moverse entre las vistas.
  //
  // Los datos los guarda main.js en un archivo JSON (window.rcData);
  // si la página se abre fuera de Electron se usa localStorage.
  // Cada contrato puede tener su documento, redactado en el editor de
  // index.html a partir de un modelo: los campos cuyo nombre coincide
  // con un dato del contrato (p. ej. "Nombre del inquilino") se
  // rellenan solos. El editor se usa a través de window.rcEditor y los
  // avisos a través de window.rcUI (ambos definidos en index.html).
  // ---------------------------------------------------------------
  const ui = window.rcUI;
  const ed = window.rcEditor;

  const $ = (id) => document.getElementById(id);

  // ---------- Utilidades ----------
  function esc(str){
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid(prefix){
    const rand = (window.crypto && crypto.randomUUID) ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
    return prefix + '-' + Date.now().toString(36) + '-' + rand;
  }

  // Quita acentos, signos y mayúsculas para comparar textos ("Cédula" = "cedula").
  function normalize(str){
    return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function byId(list, id){ return list.find(x => x.id === id) || null; }

  // Las fechas se guardan como texto 'AAAA-MM-DD' (lo que da <input type="date">),
  // así se comparan directamente como texto y no hay líos de zona horaria.
  function toDateStr(d){
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function parseDate(s){
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function todayStr(){ return toDateStr(new Date()); }
  function addDays(s, n){
    const d = parseDate(s);
    d.setDate(d.getDate() + n);
    return toDateStr(d);
  }
  function addMonths(s, n){
    const d = parseDate(s);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, lastDay));
    return toDateStr(d);
  }
  function daysBetween(a, b){ return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
  function fmtDate(s){
    if (!s) return '—';
    const [y, m, d] = s.split('-');
    return d + '/' + m + '/' + y;
  }
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  function fmtDateLong(s){
    if (!s) return '';
    const d = parseDate(s);
    return d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
  }
  function monthsOf(inicio, fin){
    if (!inicio || !fin) return null;
    return Math.max(1, Math.round(daysBetween(inicio, addDays(fin, 1)) / 30.4375));
  }
  function fmtNumber(n){
    return Number(n).toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 });
  }
  function fmtMoney(n, moneda){
    if (n == null || n === '' || isNaN(n)) return '—';
    return (moneda ? moneda + ' ' : '') + fmtNumber(n);
  }
  function plural(n, uno, varios){ return n + ' ' + (n === 1 ? uno : varios); }

  // ---------- Cédula y RNC dominicanos ----------
  // Se valida el dígito verificador sin conexión: confirma que el número
  // está bien escrito, no que pertenezca a esa persona (eso requiere a la
  // JCE). Algunas cédulas muy antiguas no cumplen el algoritmo, por eso al
  // guardar solo se avisa, no se bloquea.
  //
  // Cédula: 11 dígitos; el último se calcula con los 10 primeros alternando
  // pesos 1 y 2 (si un producto pasa de 9 se suman sus cifras).
  // RNC (DGII): 9 dígitos; pesos 7,9,8,6,5,4,3,2 y resto entre 11.
  function cedulaValida(d){
    if (!/^\d{11}$/.test(d) || d.startsWith('000')) return false;
    let suma = 0;
    for (let i = 0; i < 10; i++) {
      const p = Number(d[i]) * (i % 2 === 0 ? 1 : 2);
      suma += p > 9 ? p - 9 : p;
    }
    return (10 - (suma % 10)) % 10 === Number(d[10]);
  }
  function rncValido(d){
    if (!/^\d{9}$/.test(d)) return false;
    const pesos = [7, 9, 8, 6, 5, 4, 3, 2];
    const resto = pesos.reduce((s, w, i) => s + w * Number(d[i]), 0) % 11;
    const digito = resto === 0 ? 2 : resto === 1 ? 1 : 11 - resto;
    return digito === Number(d[8]);
  }
  // { estado: 'vacio' | 'otro' | 'valida' | 'invalida' | 'formato', formateado, mensaje }
  // permiteRnc: el campo admite también RNC (empresas).
  function revisarDocumento(texto, permiteRnc){
    const valor = String(texto || '').trim();
    if (!valor) return { estado:'vacio', mensaje:'' };
    if (/[a-z]/i.test(valor)) return { estado:'otro', mensaje:'Se guardará como pasaporte u otro documento.' };
    const d = valor.replace(/\D+/g, '');
    if (d.length === 11) {
      const formateado = d.slice(0, 3) + '-' + d.slice(3, 10) + '-' + d.slice(10);
      return cedulaValida(d)
        ? { estado:'valida', formateado, mensaje:'✓ Cédula válida (' + formateado + ')' }
        : { estado:'invalida', formateado, mensaje:'El dígito verificador no coincide: revisa los números. (Algunas cédulas muy antiguas no lo cumplen.)' };
    }
    if (permiteRnc && d.length === 9) {
      const formateado = d.slice(0, 1) + '-' + d.slice(1, 3) + '-' + d.slice(3, 8) + '-' + d.slice(8);
      return rncValido(d)
        ? { estado:'valida', formateado, mensaje:'✓ RNC válido (' + formateado + ')' }
        : { estado:'invalida', formateado, mensaje:'El dígito verificador del RNC no coincide: revisa los números.' };
    }
    return { estado:'formato', mensaje:'Una cédula tiene 11 dígitos (000-0000000-0)' + (permiteRnc ? ' y un RNC, 9' : '') + '. Si es un pasaporte, escríbelo tal cual.' };
  }
  // Para comparar documentos sin importar guiones ni espacios.
  function claveDocumento(s){ return String(s || '').replace(/[^0-9a-z]+/gi, '').toLowerCase(); }

  // ---------- Datos ----------
  const LOCAL_KEY = 'renthouse.datos.v1';
  const COLLECTIONS = ['propietarios', 'edificios', 'unidades', 'inquilinos', 'contratos', 'pagos', 'gastos', 'liquidaciones', 'casos', 'eventos', 'reparaciones', 'actas'];
  // Las que debe traer cualquier respaldo; pagos y gastos se añadieron
  // después, así que un respaldo anterior puede no tenerlas.
  const REQUIRED_COLLECTIONS = ['edificios', 'unidades', 'inquilinos', 'contratos'];
  let db = emptyDb();
  // Si los datos guardados no se pudieron leer, no se guarda nada encima
  // para no reemplazar el archivo con una base vacía.
  let loadFailed = false;

  function emptyDb(){ return { version:1, propietarios:[], edificios:[], unidades:[], inquilinos:[], contratos:[], pagos:[], gastos:[], liquidaciones:[], casos:[], eventos:[], reparaciones:[], actas:[], ajustes:{} }; }

  // Configuración guardada con los datos (db.ajustes): datos del despacho y
  // valores que se proponen al crear registros. Lo que no esté configurado
  // toma el valor de aquí.
  const AJUSTES_PREDETERMINADOS = {
    despacho: '', despachoTelefono: '', firma: 'La administración',
    moneda: 'RD$', diaPago: 1, duracionMeses: 12, avisoDias: 30,
    moraTipo: 'ninguna', moraValor: null, moraGracia: 5,
    comisionTipo: 'porcentaje', comisionValor: null,
    papel: 'Letter', salida: 'navegador',
    itbisComision: null
  };
  function ajuste(clave){
    const v = db.ajustes ? db.ajustes[clave] : undefined;
    return v === undefined || v === null || v === '' ? AJUSTES_PREDETERMINADOS[clave] : v;
  }
  // Línea "Administrado por ..." para recibos y estados de cuenta.
  function lineaDespacho(){
    if (!ajuste('despacho')) return '';
    return '<div style="color:#444;font-size:10pt;margin-top:2px;">Administrado por ' + esc(ajuste('despacho')) +
      (ajuste('despachoTelefono') ? ' · Tel. ' + esc(ajuste('despachoTelefono')) : '') + '</div>';
  }

  // Antes el propietario era un texto dentro de cada edificio; ahora es un
  // registro propio (con comisión y cuenta). Convierte los datos viejos:
  // un propietario por nombre distinto. Devuelve true si cambió algo.
  function migrateDb(){
    let changed = false;
    db.edificios.forEach(b => {
      if (!b.propietarioId && (b.propietario || b.propietarioDocumento)) {
        const nombre = String(b.propietario || '').trim() || 'Propietario de ' + b.nombre;
        let p = db.propietarios.find(x => normalize(x.nombre) === normalize(nombre));
        if (!p) {
          p = { id: uid('prp'), creado: new Date().toISOString(), nombre, documento: b.propietarioDocumento || '' };
          db.propietarios.push(p);
        } else if (!p.documento && b.propietarioDocumento) {
          p.documento = b.propietarioDocumento;
        }
        b.propietarioId = p.id;
      }
      if ('propietario' in b || 'propietarioDocumento' in b) {
        delete b.propietario;
        delete b.propietarioDocumento;
        changed = true;
      }
    });
    // Antes la comisión se definía en el propietario; ahora es del abogado
    // por edificio (y apartamento). Cada edificio hereda la de su dueño, y
    // un apartamento con dueño propio, la de ese dueño.
    const comisionDe = (p) => p && p.comisionTipo ? { comisionTipo: p.comisionTipo, comisionValor: p.comisionValor, comisionMoneda: p.comisionMoneda } : null;
    db.edificios.forEach(b => {
      if (b.comisionTipo) return;
      const c = comisionDe(byId(db.propietarios, b.propietarioId));
      if (c) { Object.assign(b, c); changed = true; }
    });
    db.unidades.forEach(u => {
      if (u.comisionTipo || !u.propietarioId) return;
      const b = byId(db.edificios, u.edificioId) || {};
      if (u.propietarioId === b.propietarioId) return;
      const c = comisionDe(byId(db.propietarios, u.propietarioId));
      if (c) { Object.assign(u, c); changed = true; }
    });
    db.propietarios.forEach(p => {
      if ('comisionTipo' in p || 'comisionValor' in p || 'comisionMoneda' in p) {
        delete p.comisionTipo; delete p.comisionValor; delete p.comisionMoneda;
        changed = true;
      }
    });
    return changed;
  }

  function normalizeDb(raw){
    const base = emptyDb();
    if (!raw || typeof raw !== 'object') return base;
    COLLECTIONS.forEach(k => { if (Array.isArray(raw[k])) base[k] = raw[k]; });
    if (raw.ajustes && typeof raw.ajustes === 'object' && !Array.isArray(raw.ajustes)) base.ajustes = raw.ajustes;
    return base;
  }

  async function loadDb(){
    try {
      if (window.rcData && window.rcData.load) {
        const result = await window.rcData.load();
        if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'respuesta vacía');
        db = normalizeDb(result.data);
        if (result.recoveredFromBackup) {
          ui.showNotice('El archivo de datos estaba dañado y se recuperó desde la copia anterior. Revisa que los últimos cambios estén presentes.', 'Datos recuperados');
        }
      } else {
        const raw = localStorage.getItem(LOCAL_KEY);
        db = normalizeDb(raw ? JSON.parse(raw) : null);
      }
    } catch (err) {
      loadFailed = true;
      db = emptyDb();
      ui.showNotice('No se pudieron leer los datos guardados (' + err.message + '). Para no perder información, no se guardarán cambios hasta reiniciar la aplicación.', 'Error al cargar datos');
      return;
    }
    if (migrateDb()) await persist();
  }

  async function persist(){
    if (loadFailed) {
      await ui.showNotice('Los datos guardados no se pudieron leer al abrir la aplicación, así que este cambio no se guardó para no sobrescribirlos. Reinicia la aplicación.', 'Cambios no guardados');
      return false;
    }
    try {
      if (window.rcData && window.rcData.save) {
        const result = await window.rcData.save(db);
        if (!result || !result.ok) throw new Error(result && result.error ? result.error : 'desconocido');
      } else {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(db));
      }
      refreshBackupStatus();
      return true;
    } catch (err) {
      await ui.showNotice('No se pudieron guardar los datos: ' + err.message, 'Error al guardar');
      return false;
    }
  }

  // ---------- Relaciones y estados ----------
  function edificioDe(unidad){ return unidad ? byId(db.edificios, unidad.edificioId) : null; }
  // Un apartamento puede tener su propio propietario; si no, es el del edificio.
  function propietarioIdDe(unidad){
    if (!unidad) return null;
    return unidad.propietarioId || (edificioDe(unidad) || {}).propietarioId || null;
  }
  function propietarioDe(unidad){ return byId(db.propietarios, propietarioIdDe(unidad)); }
  function unidadLabel(unidad){
    if (!unidad) return '(apartamento eliminado)';
    const edificio = edificioDe(unidad);
    return (edificio ? edificio.nombre + ' · ' : '') + unidad.identificador;
  }
  function isActive(c){ return c.estado !== 'finalizado'; }
  function activeContractOfUnit(unidadId, exceptId){
    return db.contratos.find(c => c.unidadId === unidadId && isActive(c) && c.id !== exceptId) || null;
  }
  // Un contrato tiene un inquilino principal y, opcionalmente, otros
  // inquilinos que firman con él (cotitulares, p. ej. una pareja).
  function inquilinosDe(c){
    return [c.inquilinoId].concat(c.cotitulares || []).map(id => byId(db.inquilinos, id)).filter(Boolean);
  }
  function nombresInquilinos(c){
    const nombres = inquilinosDe(c).map(t => t.nombre);
    return nombres.length > 1 ? nombres.slice(0, -1).join(', ') + ' y ' + nombres[nombres.length - 1] : (nombres[0] || '');
  }
  function contractsOfTenant(inquilinoId){
    return db.contratos.filter(c => c.inquilinoId === inquilinoId || (c.cotitulares || []).includes(inquilinoId))
      .sort((a, b) => (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
  }

  // Estado visible de un contrato, calculado a partir de sus fechas.
  function contractStatus(c){
    if (!isActive(c)) return { key:'finalizado', label:'Finalizado' };
    const hoy = todayStr();
    if (c.fechaInicio && c.fechaInicio > hoy) return { key:'proximo', label:'Por iniciar' };
    if (c.fechaFin && c.fechaFin < hoy) return { key:'vencido', label:'Vencido' };
    if (c.fechaFin && c.fechaFin <= addDays(hoy, ajuste('avisoDias'))) return { key:'por-vencer', label:'Por vencer' };
    return { key:'vigente', label:'Vigente' };
  }
  function badge(key, label){ return '<span class="badge badge-' + key + '">' + esc(label) + '</span>'; }

  // Botón "⋯" con las acciones secundarias de una fila, para no llenar la
  // tabla de botones. items: [{ act, id, label, periodo?, danger? }] (los
  // falsos se ignoran). El menú se abre con position:fixed para que no lo
  // recorte el desplazamiento horizontal de la tabla.
  function rowMenu(items){
    const list = items.filter(Boolean);
    if (!list.length) return '';
    return '<div class="menu-wrap"><button type="button" class="btn-panel menu-btn" data-menu aria-haspopup="true" aria-expanded="false" title="Más acciones" aria-label="Más acciones">⋯</button>' +
      '<div class="row-menu" role="menu" hidden>' + list.map(it =>
        '<button type="button" role="menuitem"' + (it.danger ? ' class="danger"' : '') + ' data-act="' + it.act + '" data-id="' + esc(it.id) + '"' +
        (it.periodo ? ' data-periodo="' + esc(it.periodo) + '"' : '') + '>' + esc(it.label) + '</button>').join('') + '</div></div>';
  }
  function closeRowMenus(){
    document.querySelectorAll('.row-menu:not([hidden])').forEach(m => {
      m.hidden = true;
      const btn = m.parentElement.querySelector('[data-menu]');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    });
  }
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-menu]');
    if (!btn) { closeRowMenus(); return; }
    const menu = btn.parentElement.querySelector('.row-menu');
    const abrir = menu.hidden;
    closeRowMenus();
    if (!abrir) return;
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    const r = btn.getBoundingClientRect();
    const alto = menu.offsetHeight;
    menu.style.top = (r.bottom + 4 + alto > window.innerHeight ? Math.max(8, r.top - alto - 4) : r.bottom + 4) + 'px';
    menu.style.left = Math.max(8, r.right - menu.offsetWidth) + 'px';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeRowMenus(); });
  window.addEventListener('scroll', closeRowMenus, true);
  window.addEventListener('resize', closeRowMenus);

  // ---------- Datos del contrato que se pueden poner en el documento ----------
  // "label" es el nombre sugerido al insertar un campo en el editor; los
  // "aliases" son otras formas en que un modelo existente puede haberlo
  // llamado. La comparación ignora acentos y mayúsculas.
  const VARIABLES = [
    { label:'Nombre del inquilino', aliases:['inquilino','arrendatario','nombre del arrendatario','nombre inquilino','nombre completo del inquilino'], get: x => x.t.nombre },
    { label:'Documento del inquilino', aliases:['cedula','cedula del inquilino','documento','pasaporte','cedula del arrendatario','documento del arrendatario'], get: x => x.t.documento },
    { label:'Nacionalidad del inquilino', aliases:['nacionalidad','nacionalidad del arrendatario'], get: x => x.t.nacionalidad },
    { label:'Estado civil del inquilino', aliases:['estado civil','estado civil del arrendatario'], get: x => x.t.estadoCivil },
    { label:'Ocupación del inquilino', aliases:['ocupacion','profesion','profesion del inquilino'], get: x => x.t.ocupacion },
    { label:'Teléfono del inquilino', aliases:['telefono','telefono del arrendatario'], get: x => x.t.telefono },
    { label:'Correo del inquilino', aliases:['correo','email','correo electronico'], get: x => x.t.email },
    { label:'Domicilio del inquilino', aliases:['domicilio','domicilio del arrendatario','direccion del inquilino'], get: x => x.t.direccion },
    { label:'Todos los inquilinos', aliases:['inquilinos','arrendatarios','nombres de los inquilinos'], get: x => nombresInquilinos(x.c) },
    { label:'Inquilinos con sus documentos', aliases:['inquilinos y documentos','arrendatarios y cedulas'],
      get: x => inquilinosDe(x.c).map(t => t.nombre + (t.documento ? ', documento ' + t.documento : '')).join('; ') },
    { label:'Nombre del fiador', aliases:['fiador','garante','nombre del garante'], get: x => x.c.fiadorNombre },
    { label:'Documento del fiador', aliases:['cedula del fiador','cedula del garante'], get: x => x.c.fiadorDocumento },
    { label:'Domicilio del fiador', aliases:['direccion del fiador','domicilio del garante'], get: x => x.c.fiadorDireccion },
    { label:'Teléfono del fiador', aliases:['telefono del fiador'], get: x => x.c.fiadorTelefono },
    { label:'Recargo por mora', aliases:['mora','penalidad','recargo'], get: x => hasMora(x.c) ? moraLabel(x.c) : '' },
    { label:'Nombre del propietario', aliases:['propietario','arrendador','nombre del arrendador'], get: x => x.p && x.p.nombre },
    { label:'Documento del propietario', aliases:['cedula del propietario','cedula del arrendador','documento del arrendador'], get: x => x.p && x.p.documento },
    { label:'Domicilio del propietario', aliases:['direccion del propietario','domicilio del arrendador'], get: x => x.p && x.p.direccion },
    { label:'Edificio', aliases:['nombre del edificio','residencial','inmueble'], get: x => x.b && x.b.nombre },
    { label:'Dirección del inmueble', aliases:['direccion','direccion del edificio','ubicacion'], get: x => x.b && x.b.direccion },
    { label:'Apartamento', aliases:['unidad','numero de apartamento','apartamento numero','apto','local'], get: x => x.u && x.u.identificador },
    { label:'Monto del alquiler', aliases:['renta','alquiler','monto','precio','canon','mensualidad','renta mensual'], get: x => fmtMoney(x.c.monto, x.c.moneda) },
    { label:'Depósito', aliases:['deposito','fianza','garantia','deposito de garantia'], get: x => x.c.deposito != null ? fmtMoney(x.c.deposito, x.c.moneda) : '' },
    { label:'Día de pago', aliases:['dia de pago','fecha de pago'], get: x => x.c.diaPago ? String(x.c.diaPago) : '' },
    { label:'Fecha de inicio', aliases:['inicio','fecha inicio','fecha de inicio del contrato'], get: x => fmtDateLong(x.c.fechaInicio) },
    { label:'Fecha de fin', aliases:['fin','fecha fin','fecha de vencimiento','vencimiento','fecha de terminacion'], get: x => fmtDateLong(x.c.fechaFin) },
    { label:'Duración del contrato', aliases:['duracion','plazo','vigencia'], get: x => { const m = monthsOf(x.c.fechaInicio, x.c.fechaFin); return m ? plural(m, 'mes', 'meses') : ''; } },
    { label:'Fecha de hoy', aliases:['fecha','fecha actual','fecha del contrato'], get: () => fmtDateLong(todayStr()) },
    { label:'Aumento anual', aliases:['porcentaje de aumento','aumento'], get: x => Number(x.c.aumentoPct) > 0 ? fmtNumber(x.c.aumentoPct).replace(/[.,]00$/, '') + '%' : '' },
    { label:'Monto del alquiler en letras', aliases:['alquiler en letras','renta en letras','monto en letras'], get: x => montoEnLetras(x.c.monto, x.c.moneda) },
    { label:'Deuda total', aliases:['deuda','monto adeudado','suma adeudada','total adeudado'], get: x => { const d = deudaDe(x.c); return d.monto > 0 ? fmtMoney(d.monto, x.c.moneda) : ''; } },
    { label:'Deuda en letras', aliases:['monto adeudado en letras','suma adeudada en letras'], get: x => { const d = deudaDe(x.c); return d.monto > 0 ? montoEnLetras(d.monto, x.c.moneda) : ''; } },
    { label:'Meses adeudados', aliases:['meses atrasados','cantidad de meses adeudados'], get: x => { const d = deudaDe(x.c); return d.meses ? plural(d.meses, 'mes', 'meses') : ''; } },
    { label:'Detalle de la deuda', aliases:['periodos adeudados','meses que debe'], get: x => periodosEnTexto(deudaDe(x.c).cuotas) },
    { label:'Tribunal', aliases:['juzgado','juzgado de paz','tribunal apoderado'], get: x => x.k && x.k.tribunal },
    { label:'Número de expediente', aliases:['expediente','no. de expediente'], get: x => x.k && x.k.numeroExpediente },
    { label:'Alguacil', aliases:['ministerial','nombre del alguacil'], get: x => x.k && x.k.alguacil },
    { label:'Nombre del despacho', aliases:['despacho','bufete','abogado'], get: () => ajuste('despacho') }
  ];
  const VARIABLE_INDEX = new Map();
  VARIABLES.forEach(v => [v.label].concat(v.aliases).forEach(name => VARIABLE_INDEX.set(normalize(name), v)));

  function fillEditorFromContract(c, caso){
    const ctx = { c, k: caso || null, t: byId(db.inquilinos, c.inquilinoId) || {}, u: byId(db.unidades, c.unidadId) };
    ctx.b = edificioDe(ctx.u);
    ctx.p = propietarioDe(ctx.u);
    return ed.fillFields(label => {
      const variable = VARIABLE_INDEX.get(normalize(label));
      return variable ? (variable.get(ctx) || null) : null;
    });
  }

  const suggestions = $('fieldLabelSuggestions');
  if (suggestions) suggestions.innerHTML = VARIABLES.map(v => '<option value="' + esc(v.label) + '"></option>').join('');

  // ---------- Navegación ----------
  const VIEW_KEY = 'renthouse.vista';
  const VIEW_TITLES = {
    resumen:'Resumen', propietarios:'Propietarios', edificios:'Edificios', unidades:'Apartamentos',
    inquilinos:'Inquilinos', contratos:'Contratos', mantenimiento:'Mantenimiento',
    cobros:'Cobros', gastos:'Gastos', liquidaciones:'Liquidaciones', balance:'Balance', reportes:'Reportes',
    casos:'Casos de cobro y desalojo', agenda:'Agenda',
    configuracion:'Configuración',
    redactor:'Redactor de contratos'
  };
  let activeView = 'resumen';
  const navItems = document.querySelectorAll('.nav-item[data-view]');

  // Plan de la licencia (lo decide la pantalla de licencia con 'rc-plan'):
  // "redactor" deja solo el redactor y Configuración; "completo", todo.
  const VISTAS_PLAN_REDACTOR = ['redactor', 'configuracion'];
  let planLicencia = window.rcPlan || 'completo';
  function soloRedactor(){ return planLicencia === 'redactor'; }
  function aplicarPlan(plan){
    planLicencia = plan === 'redactor' ? 'redactor' : 'completo';
    document.body.dataset.plan = planLicencia;
    if (soloRedactor()) {
      document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
      if (!VISTAS_PLAN_REDACTOR.includes(activeView)) showView('redactor');
    }
  }
  document.addEventListener('rc-plan', (e) => aplicarPlan(e.detail));

  function showView(name){
    if (!VIEW_TITLES[name]) name = 'resumen';
    if (soloRedactor() && !VISTAS_PLAN_REDACTOR.includes(name)) name = 'redactor';
    activeView = name;
    document.body.dataset.activeView = name;
    document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
    navItems.forEach(b => b.classList.toggle('active', b.dataset.view === name));
    $('viewTitle').textContent = VIEW_TITLES[name];
    try { localStorage.setItem(VIEW_KEY, name); } catch (err) { /* no crítico */ }
    renderActive();
    window.scrollTo(0, 0);
    animarEntrada(document.querySelector('.view[data-view="' + name + '"]'));
  }

  // Entrada animada de una vista (ver "Animaciones" en gestion.css). La clase
  // se quita al terminar, para que los re-renders posteriores (al guardar o
  // filtrar) no vuelvan a animar tarjetas y filas.
  let entradaTimer = null;
  function animarEntrada(view){
    if (!view) return;
    document.querySelectorAll('.view-enter').forEach(v => v.classList.remove('view-enter'));
    void view.offsetWidth; // reinicia la animación si se vuelve a la misma vista
    view.classList.add('view-enter');
    clearTimeout(entradaTimer);
    entradaTimer = setTimeout(() => view.classList.remove('view-enter'), 900);
  }

  navItems.forEach(b => b.addEventListener('click', () => showView(b.dataset.view)));

  // Menú recortado (solo íconos). El <head> ya aplica la clase guardada
  // antes de pintar; aquí solo se sincroniza el botón y se guarda el cambio.
  const MENU_KEY = 'renthouse.menuRecortado';
  const btnNavToggle = $('btnNavToggle');
  function syncNavToggle(){
    const recortado = document.documentElement.classList.contains('nav-collapsed');
    const texto = recortado ? 'Mostrar el menú completo' : 'Recortar el menú';
    btnNavToggle.setAttribute('aria-pressed', recortado ? 'true' : 'false');
    btnNavToggle.title = texto;
    btnNavToggle.setAttribute('aria-label', texto);
  }
  btnNavToggle.addEventListener('click', () => {
    const recortado = document.documentElement.classList.toggle('nav-collapsed');
    try { localStorage.setItem(MENU_KEY, recortado ? '1' : '0'); } catch (err) { /* no crítico */ }
    syncNavToggle();
    if (activeView === 'configuracion') renderConfiguracion();
  });
  syncNavToggle();

  function renderActive(){
    renderNavCounts();
    if (activeView === 'resumen') renderResumen();
    else if (activeView === 'edificios') renderEdificios();
    else if (activeView === 'unidades') renderUnidades();
    else if (activeView === 'inquilinos') renderInquilinos();
    else if (activeView === 'contratos') renderContratos();
    else if (activeView === 'cobros') renderCobros();
    else if (activeView === 'gastos') renderGastos();
    else if (activeView === 'balance') renderBalance();
    else if (activeView === 'propietarios') renderPropietarios();
    else if (activeView === 'liquidaciones') renderLiquidaciones();
    else if (activeView === 'reportes') renderReportes();
    else if (activeView === 'configuracion') renderConfiguracion();
    else if (activeView === 'casos') renderCasos();
    else if (activeView === 'mantenimiento') renderMantenimiento();
    else if (activeView === 'agenda') renderAgenda();
    if (tenantDetailId) renderTenantDetail();
    if (casoId) renderCasoDetalle();
    updateLinkBar();
  }

  function renderNavCounts(){
    document.querySelectorAll('[data-count]').forEach(el => {
      const key = el.dataset.count;
      const n = key === 'atrasados' ? db.contratos.filter(c => deudaDe(c).monto > 0).length
        : key === 'reparacionesAbiertas' ? db.reparaciones.filter(r => r.estado !== 'resuelta').length
        : key === 'casosAbiertos' ? db.casos.filter(casoAbierto).length
        : key === 'agendaPendiente' ? pendientesHoy().length
        : key === 'liquidacionesPendientes' ? liquidacionesDelMes(addMonthsP(monthOf(todayStr()), -1)).filter(liqPendiente).length
        : db[key].length;
      el.textContent = n ? String(n) : '';
    });
  }

  // Botones "+ Nuevo ..." de las cabeceras.
  document.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => {
    const kind = b.dataset.new;
    if (kind === 'edificio') openEdificioForm();
    else if (kind === 'unidad') openUnidadForm(null, { edificioId: $('filterUnidadesEdificio').value || '' });
    else if (kind === 'inquilino') openInquilinoForm();
    else if (kind === 'contrato') openContratoForm();
    else if (kind === 'pago') openPagoForm(null, { periodo: cobrosMes.value });
    else if (kind === 'gasto') openGastoForm(null, { edificioId: gastosEdificio.value || '' });
    else if (kind === 'propietario') openPropietarioForm();
    else if (kind === 'caso') openCasoForm();
    else if (kind === 'reparacion') openReparacionForm(null, { edificioId: mntEdificio.value || '' });
    else if (kind === 'evento') openEventoForm();
  }));

  // Acciones de las filas: <button data-act="..." data-id="...">.
  function bindActions(container, handlers){
    container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn || !container.contains(btn)) return;
      const handler = handlers[btn.dataset.act];
      if (handler) handler(btn.dataset.id, btn);
    });
  }

  function emptyState(title, text, buttonHtml){
    return '<div class="empty-state"><strong>' + esc(title) + '</strong>' + esc(text) + (buttonHtml ? '<br>' + buttonHtml : '') + '</div>';
  }

  // ---------- Resumen ----------
  function renderResumen(){
    const totalUnidades = db.unidades.length;
    const ocupadas = db.unidades.filter(u => activeContractOfUnit(u.id)).length;
    const activos = db.contratos.filter(isActive);
    const ocupacion = totalUnidades ? Math.round(ocupadas / totalUnidades * 100) : 0;

    const ingresos = {};
    activos.forEach(c => {
      if (c.monto == null || isNaN(c.monto)) return;
      const key = c.moneda || '';
      ingresos[key] = (ingresos[key] || 0) + Number(c.monto);
    });
    const ingresoTexto = Object.keys(ingresos).length
      ? Object.keys(ingresos).map(m => esc(fmtMoney(ingresos[m], m))).join('<br>')
      : '—';

    const inquilinosActivos = new Set(activos.map(c => c.inquilinoId)).size;

    const mes = monthOf(todayStr());
    const cuotasMes = db.contratos.filter(c => contractCoversPeriod(c, mes)).map(c => cuota(c, mes));
    const pagadas = cuotasMes.filter(q => q.key === 'pagado').length;
    const deudores = db.contratos.map(c => ({ c, d: deudaDe(c) })).filter(x => x.d.monto > 0);

    $('dashStats').innerHTML = [
      stat('Edificios', db.edificios.length, plural(totalUnidades, 'apartamento registrado', 'apartamentos registrados')),
      stat('Ocupación', totalUnidades ? ocupacion + '%' : '—', ocupadas + ' ocupados · ' + (totalUnidades - ocupadas) + ' disponibles'),
      stat('Inquilinos', db.inquilinos.length, plural(inquilinosActivos, 'con contrato activo', 'con contrato activo')),
      stat('Alquiler mensual', ingresoTexto, plural(activos.length, 'contrato activo', 'contratos activos'), true),
      stat('Cobros de ' + MESES[Number(mes.slice(5)) - 1], cuotasMes.length ? pagadas + ' / ' + cuotasMes.length : '—',
        cuotasMes.length ? (deudores.length ? plural(deudores.length, 'contrato con pagos atrasados', 'contratos con pagos atrasados') : 'Nadie tiene pagos atrasados') : 'Sin cuotas este mes')
    ].join('');

    const hoy = todayStr();
    const alertas = activos
      .map(c => ({ c, s: contractStatus(c) }))
      .filter(x => x.s.key === 'vencido' || x.s.key === 'por-vencer')
      .sort((a, b) => (a.c.fechaFin || '').localeCompare(b.c.fechaFin || ''));
    const alertasPago = deudores
      .sort((a, b) => b.d.meses - a.d.meses || b.d.monto - a.d.monto)
      .map(({ c, d }) => {
        const t = byId(db.inquilinos, c.inquilinoId);
        return '<div class="alert-row">' + badge('atrasado', 'Pago atrasado') +
          '<div class="alert-main"><strong>' + esc(t ? t.nombre : '(inquilino eliminado)') + '</strong>' +
          '<span class="cell-sub">' + esc(unidadLabel(byId(db.unidades, c.unidadId))) + ' · debe ' + esc(fmtMoney(d.monto, c.moneda)) + ' (' + plural(d.meses, 'mes', 'meses') + ')</span></div>' +
          '<button type="button" class="btn-panel" data-act="pagar" data-id="' + esc(c.id) + '" data-periodo="' + esc(d.primerPeriodo) + '">Registrar pago</button></div>';
      }).join('');
    const mesAnterior = addMonthsP(mes, -1);
    const liqPendientes = liquidacionesDelMes(mesAnterior).filter(liqPendiente);
    const montos = (fn) => Object.entries(sumByMoneda(liqPendientes, fn, l => l.moneda)).filter(([, n]) => n > 0).map(([m, n]) => esc(fmtMoney(n, m))).join(' · ') || '—';
    const alertaLiq = liqPendientes.length
      ? '<div class="alert-row">' + badge('parcial', 'Liquidación') +
          '<div class="alert-main"><strong>' + plural(liqPendientes.length, 'edificio', 'edificios') + ' sin liquidar de ' + esc(fmtPeriodo(mesAnterior)) + '</strong>' +
          '<span class="cell-sub">Tu comisión: ' + montos(l => l.comision) + ' · Al propietario: ' + montos(l => l.neto) + '</span></div>' +
          '<button type="button" class="btn-panel" data-act="ver-liquidacion" data-id="" data-periodo="' + esc(mesAnterior) + '">Ver liquidaciones</button></div>'
      : '';
    const proximos = db.eventos.filter(ev => !ev.hecho && ev.fecha <= addDays(hoy, 3))
      .sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
    const alertaAgenda = proximos.map(ev => {
      const k = ev.casoId ? byId(db.casos, ev.casoId) : null;
      return '<div class="alert-row">' + badge(ev.fecha < hoy ? 'atrasado' : 'proximo', tipoEventoLabel(ev.tipo)) +
        '<div class="alert-main"><strong>' + esc(ev.titulo) + '</strong>' +
        '<span class="cell-sub">' + esc(cuandoEs(ev.fecha).replace(/^./, ch => ch.toUpperCase())) + ' (' + esc(fmtDate(ev.fecha)) + (ev.hora ? ', ' + esc(ev.hora) : '') + ')' + (k ? ' · ' + esc(casoTitulo(k)) : '') + '</span></div>' +
        '<button type="button" class="btn-panel" data-act="' + (k ? 'ver-caso' : 'ir-agenda') + '" data-id="' + esc(k ? k.id : '') + '">' + (k ? 'Ver caso' : 'Ver agenda') + '</button></div>';
    }).join('');
    const alertaAumentos = aumentosPorAplicar().map(({ c, a }) => '<div class="alert-row">' + badge('por-vencer', 'Aumento') +
      '<div class="alert-main"><strong>' + esc(contractTitle(c)) + '</strong>' +
      '<span class="cell-sub">De ' + esc(fmtMoney(a.actual, c.moneda)) + ' a ' + esc(fmtMoney(a.nuevo, c.moneda)) + ' desde ' + esc(fmtPeriodo(a.periodo)) + ' (' + esc(fmtNumber(c.aumentoPct).replace(/[.,]00$/, '')) + '%)</span></div>' +
      '<button type="button" class="btn-panel" data-act="aumento" data-id="' + esc(c.id) + '">Aplicar aumento</button></div>').join('');
    const porEnviar = Number(hoy.slice(8)) <= 10 ? filasEstados(mesAnterior).filter(f => !estadoEnviado(f, mesAnterior)) : [];
    const alertaEstados = porEnviar.length
      ? '<div class="alert-row">' + badge('proximo', 'Liquidaciones') +
          '<div class="alert-main"><strong>' + plural(porEnviar.length, 'liquidación', 'liquidaciones') + ' de ' + esc(fmtPeriodo(mesAnterior)) + ' por enviar a los propietarios</strong>' +
          '<span class="cell-sub">' + esc(porEnviar.map(f => edificioNombre(f) + ' (' + f.propietario.nombre + ')').join(', ')) + '</span></div>' +
          '<button type="button" class="btn-panel" data-act="estados-cuenta-mes" data-id="" data-periodo="' + esc(mesAnterior) + '">Enviar</button></div>'
      : '';
    const urgentes = db.reparaciones.filter(r => r.estado !== 'resuelta' && (r.prioridad === 'urgente' || r.prioridad === 'alta'));
    const alertaReparaciones = urgentes.length
      ? '<div class="alert-row">' + badge('atrasado', 'Reparación') +
          '<div class="alert-main"><strong>' + plural(urgentes.length, 'reparación urgente o de prioridad alta', 'reparaciones urgentes o de prioridad alta') + ' sin resolver</strong>' +
          '<span class="cell-sub">' + esc(urgentes.slice(0, 3).map(r => repLugar(r) + ': ' + r.descripcion).join(' · ')) + '</span></div>' +
          '<button type="button" class="btn-panel" data-act="ir-mantenimiento" data-id="">Ver</button></div>'
      : '';
    $('dashAlerts').innerHTML = (alertas.length || alertasPago || alertaLiq || alertaAgenda || alertaAumentos || alertaEstados || alertaReparaciones)
      ? alertaAgenda + alertaReparaciones + alertaLiq + alertaEstados + alertasPago + alertaAumentos + alertas.map(({ c, s }) => {
          const t = byId(db.inquilinos, c.inquilinoId);
          const dias = daysBetween(hoy, c.fechaFin);
          const cuando = dias < 0 ? 'Venció hace ' + plural(-dias, 'día', 'días') : (dias === 0 ? 'Vence hoy' : 'Vence en ' + plural(dias, 'día', 'días'));
          return '<div class="alert-row">' + badge(s.key, s.label) +
            '<div class="alert-main"><strong>' + esc(t ? t.nombre : '(inquilino eliminado)') + '</strong>' +
            '<span class="cell-sub">' + esc(unidadLabel(byId(db.unidades, c.unidadId))) + ' · ' + esc(cuando) + ' (' + esc(fmtDate(c.fechaFin)) + ')</span></div>' +
            '<button type="button" class="btn-panel" data-act="editar-contrato" data-id="' + esc(c.id) + '">Ver contrato</button></div>';
        }).join('')
      : emptyState('Todo en orden', 'No hay pagos atrasados, liquidaciones pendientes ni contratos que venzan en los próximos ' + ajuste('avisoDias') + ' días.');

    $('dashBuildings').innerHTML = db.edificios.length
      ? db.edificios.map(b => {
          const unidades = db.unidades.filter(u => u.edificioId === b.id);
          const occ = unidades.filter(u => activeContractOfUnit(u.id)).length;
          const pct = unidades.length ? Math.round(occ / unidades.length * 100) : 0;
          return '<div class="occ-row"><div class="occ-top"><button type="button" class="link-btn" data-act="ver-unidades" data-id="' + esc(b.id) + '">' + esc(b.nombre) + '</button>' +
            '<span>' + occ + ' / ' + unidades.length + '</span></div><div class="occ-bar"><span style="width:' + pct + '%"></span></div></div>';
        }).join('')
      : emptyState('Sin edificios', 'Registra tu primer edificio para empezar.', '<button type="button" class="btn-brass" data-act="nuevo-edificio">+ Nuevo edificio</button>');
  }

  // "value" ya viene como HTML seguro (número, porcentaje o montos escapados).
  function stat(label, value, sub, small){
    return '<div class="stat-card"><div class="stat-label">' + esc(label) + '</div>' +
      '<div class="stat-value' + (small ? ' small' : '') + '">' + value + '</div>' +
      '<div class="stat-sub">' + esc(sub) + '</div></div>';
  }

  // ---------- Edificios ----------
  const searchEdificios = $('searchEdificios');
  searchEdificios.addEventListener('input', renderEdificios);

  function compareIds(a, b){ return String(a).localeCompare(String(b), undefined, { numeric:true }); }

  // Estado de un apartamento para pintar su casilla.
  function tileStatus(u){
    const c = activeContractOfUnit(u.id);
    if (!c) return { key:'disponible', label:'Disponible', c:null };
    const s = contractStatus(c);
    if (s.key === 'por-vencer' || s.key === 'vencido') return { key:s.key, label:s.label, c };
    return { key:'ocupado', label:'Ocupado', c };
  }

  // "Juan Pérez Gómez" -> "Juan P."
  function shortName(nombre){
    const parts = String(nombre || '').trim().split(/\s+/);
    return parts.length > 1 ? parts[0] + ' ' + parts[1].charAt(0) + '.' : parts[0];
  }

  function tileHtml(u){
    const st = tileStatus(u);
    const t = st.c ? byId(db.inquilinos, st.c.inquilinoId) : null;
    const title = u.identificador + ' — ' + st.label + (t ? ': ' + t.nombre + ', hasta el ' + fmtDate(st.c.fechaFin) : '. Clic para alquilar');
    return '<div class="unit-tile tile-' + st.key + '" role="button" tabindex="0" data-act="tile" data-id="' + esc(u.id) + '" title="' + esc(title) + '">' +
      '<span class="tile-id">' + esc(u.identificador) + '</span>' +
      '<span class="tile-sub">' + esc(t ? shortName(t.nombre) : st.label) + '</span>' +
      '<button type="button" class="tile-edit" data-act="editar-unidad" data-id="' + esc(u.id) + '" title="Editar apartamento" aria-label="Editar apartamento">✎</button>' +
    '</div>';
  }

  // Casillas de un edificio agrupadas por piso, con el piso más alto
  // arriba (como la fachada). Los apartamentos sin piso van al final.
  function buildingTilesHtml(b, unidades){
    const addTile = '<button type="button" class="unit-tile tile-add" data-act="nueva-unidad-en" data-id="' + esc(b.id) + '" title="Añadir un apartamento a este edificio">+ Añadir</button>';
    if (!unidades.length) {
      return '<div class="floor-row no-label"><div class="tiles">' + addTile + '</div></div>';
    }
    const grupos = new Map();
    unidades.forEach(u => {
      const key = u.piso != null && u.piso !== '' ? Number(u.piso) : null;
      if (!grupos.has(key)) grupos.set(key, []);
      grupos.get(key).push(u);
    });
    const keys = [...grupos.keys()].sort((a, b) => (b == null ? -Infinity : b) - (a == null ? -Infinity : a));
    const showLabels = keys.length > 1;
    return keys.map((key, i) => {
      const tiles = grupos.get(key).sort((a, b) => compareIds(a.identificador, b.identificador)).map(tileHtml).join('') +
        (i === keys.length - 1 ? addTile : '');
      return '<div class="floor-row' + (showLabels ? '' : ' no-label') + '">' +
        (showLabels ? '<span class="floor-label">' + (key == null ? 'Sin piso' : 'Piso ' + key) + '</span>' : '') +
        '<div class="tiles">' + tiles + '</div></div>';
    }).join('');
  }

  function renderEdificios(){
    const q = normalize(searchEdificios.value);
    const list = db.edificios
      .filter(b => !q || normalize([b.nombre, b.direccion, (byId(db.propietarios, b.propietarioId) || {}).nombre].join(' ')).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    const el = $('tableEdificios');
    if (!db.edificios.length) {
      el.innerHTML = '<div class="mgmt-card">' + emptyState('Todavía no hay edificios', 'Sus apartamentos se crean solos.', '<button type="button" class="btn-brass" data-act="nuevo-edificio">+ Nuevo edificio</button>') + '</div>';
      return;
    }
    if (!list.length) { el.innerHTML = '<div class="mgmt-card">' + emptyState('Sin resultados', 'Ningún edificio coincide con la búsqueda.') + '</div>'; return; }
    el.innerHTML = list.map(b => {
      const unidades = db.unidades.filter(u => u.edificioId === b.id);
      const occ = unidades.filter(u => activeContractOfUnit(u.id)).length;
      const pct = unidades.length ? Math.round(occ / unidades.length * 100) : 0;
      const dueno = byId(db.propietarios, b.propietarioId);
      const sub = [b.direccion, dueno ? 'Propietario: ' + dueno.nombre : 'Sin propietario asignado', 'Comisión: ' + comisionLabel(b)].filter(Boolean).join(' · ');
      return '<article class="bld-card">' +
        '<div class="bld-head">' +
          '<div class="bld-title"><h3>' + esc(b.nombre) + '</h3>' + (sub ? '<span class="cell-sub">' + esc(sub) + '</span>' : '') + '</div>' +
          '<div class="bld-occ"><div class="occ-top"><span>' + plural(unidades.length, 'apartamento', 'apartamentos') + '</span><span>' + occ + ' ocupados · ' + pct + '%</span></div>' +
            '<div class="occ-bar"><span style="width:' + pct + '%"></span></div></div>' +
          '<div class="row-actions">' +
            '<button type="button" class="btn-panel" data-act="ver-unidades" data-id="' + esc(b.id) + '">Ver en lista</button>' +
            '<button type="button" class="btn-panel" data-act="editar-edificio" data-id="' + esc(b.id) + '">Editar</button>' +
            '<button type="button" class="btn-wine" data-act="borrar-edificio" data-id="' + esc(b.id) + '">Eliminar</button>' +
          '</div>' +
        '</div>' +
        '<div class="bld-floors">' + buildingTilesHtml(b, unidades) + '</div>' +
      '</article>';
    }).join('');
  }

  // Las casillas son <div role="button">: Enter o espacio las activan como un clic.
  $('tableEdificios').addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('unit-tile')) {
      e.preventDefault();
      e.target.click();
    }
  });

  const MAX_UNIDADES = 500;

  // Numeración propuesta para "n" apartamentos repartidos en "pisos":
  // con varios pisos 101, 102, 201...; con uno solo 1, 2, 3...
  // Si no se reparten exacto, los pisos más bajos llevan uno más.
  function planUnidades(n, pisos){
    const list = [];
    if (pisos <= 1) {
      for (let i = 1; i <= n; i++) list.push({ piso: 1, identificador: String(i) });
      return list;
    }
    const base = Math.floor(n / pisos);
    const extra = n % pisos;
    for (let piso = 1; piso <= pisos; piso++) {
      const k = base + (piso <= extra ? 1 : 0);
      for (let num = 1; num <= k; num++) list.push({ piso, identificador: piso + String(num).padStart(2, '0') });
    }
    return list;
  }

  function edificioFields(current){
    return [
      { name:'nombre', label:'Nombre del edificio', required:true, full:true, placeholder:'Ej: Residencial Las Palmas' },
      { name:'direccion', label:'Dirección', full:true, placeholder:'Calle, número, sector, ciudad' },
      { name:'cantidad', label:'Cantidad de apartamentos', type:'number', required:true, min:0, max:MAX_UNIDADES, step:'1',
        help: current ? 'Al reducir solo se quitan apartamentos libres.' : '' },
      { name:'pisos', label:'Pisos', type:'number', min:1, max:200, step:'1' },
      { name:'propietarioId', label:'Propietario', type:'select', options: propietarioOptions('— Sin asignar —') },
      { name:'propietarioNuevo', label:'…o registra uno nuevo', placeholder:'Nombre del propietario nuevo' },
      { name:'_comision', type:'heading', label:'Comisión del abogado' },
      { name:'comisionTipo', label:'Tipo de comisión', type:'select', options: COMISION_TIPOS },
      { name:'comisionValor', label:'Valor de la comisión', type:'number', min:0, step:'0.01', help:'Porcentaje o monto fijo.' },
      { name:'comisionMoneda', label:'Moneda (si es monto fijo)', type:'select', options: MONEDAS.map(m => ({ value:m, label:m })) },
      { name:'notas', label:'Notas', type:'textarea', full:true }
    ];
  }

  function openEdificioForm(id){
    const current = id ? byId(db.edificios, id) : null;
    const existentes = current ? db.unidades.filter(u => u.edificioId === current.id) : [];
    openForm({
      title: current ? 'Editar edificio' : 'Nuevo edificio',
      fields: edificioFields(current),
      values: Object.assign({ pisos: 1, comisionTipo: ajuste('comisionTipo'), comisionValor: ajuste('comisionValor'), comisionMoneda: ajuste('moneda') }, current, { cantidad: current ? existentes.length : '' }),
      async onSave(values){
        if (values.comisionTipo === 'porcentaje' && values.comisionValor > 100) return 'El porcentaje de comisión no puede ser mayor que 100.';
        const cantidad = values.cantidad;
        const pisos = values.pisos == null ? 1 : values.pisos;
        delete values.cantidad;
        if (!Number.isInteger(cantidad) || cantidad > MAX_UNIDADES) return 'La cantidad de apartamentos debe ser un número entero entre 0 y ' + MAX_UNIDADES + '.';
        if (!Number.isInteger(pisos) || pisos < 1) return 'El número de pisos debe ser un número entero mayor que 0.';
        if (cantidad > 0 && pisos > cantidad) return 'Hay más pisos (' + pisos + ') que apartamentos (' + cantidad + ').';
        values.pisos = pisos;

        // Al reducir solo se quitan apartamentos sin ningún contrato
        // (ni activo ni finalizado), para no perder historial.
        let quitar = [];
        if (cantidad < existentes.length) {
          const sobran = existentes.length - cantidad;
          const libres = existentes
            .filter(u => !db.contratos.some(c => c.unidadId === u.id))
            .sort((a, b) => ((Number(b.piso) || 0) - (Number(a.piso) || 0)) || compareIds(b.identificador, a.identificador));
          if (libres.length < sobran) {
            return 'Para bajar a ' + cantidad + ' habría que eliminar ' + plural(sobran, 'apartamento', 'apartamentos') + ', pero solo ' +
              plural(libres.length, 'no tiene', 'no tienen') + ' contratos registrados. Los apartamentos con contratos no se eliminan.';
          }
          quitar = libres.slice(0, sobran);
          const ok = await ui.showConfirmDialog('Se eliminarán ' + plural(sobran, 'apartamento', 'apartamentos') + ': ' +
            quitar.map(u => u.identificador).sort(compareIds).join(', ') + '. ¿Continuar?', 'Reducir apartamentos');
          if (!ok) return false;
        }

        values.propietarioId = takeNewPropietario(values) || values.propietarioId || null;
        let edificio = current;
        if (current) Object.assign(current, values);
        else {
          edificio = Object.assign({ id: uid('edf'), creado: new Date().toISOString() }, values);
          db.edificios.push(edificio);
        }
        if (quitar.length) {
          const ids = new Set(quitar.map(u => u.id));
          db.unidades = db.unidades.filter(u => !ids.has(u.id));
        }
        if (cantidad > existentes.length) {
          // Se crean los de la numeración propuesta que todavía no existen.
          const usados = new Set(existentes.map(u => normalize(u.identificador)));
          const ahora = new Date().toISOString();
          planUnidades(cantidad, pisos)
            .filter(p => !usados.has(normalize(p.identificador)))
            .slice(0, cantidad - existentes.length)
            .forEach(p => db.unidades.push({ id: uid('apt'), creado: ahora, edificioId: edificio.id, identificador: p.identificador, piso: p.piso, tipo: 'Apartamento' }));
        }
        return persist();
      }
    });
  }

  async function deleteEdificio(id){
    const b = byId(db.edificios, id);
    if (!b) return;
    const unidades = db.unidades.filter(u => u.edificioId === id);
    if (unidades.length) {
      await ui.showNotice('"' + b.nombre + '" tiene ' + plural(unidades.length, 'apartamento registrado', 'apartamentos registrados') + '. Elimínalos o muévelos a otro edificio antes de borrarlo.', 'No se puede eliminar');
      return;
    }
    const gastos = db.gastos.filter(g => g.edificioId === id).length;
    if (gastos) {
      await ui.showNotice('"' + b.nombre + '" tiene ' + plural(gastos, 'gasto registrado', 'gastos registrados') + '. Para conservar la contabilidad no se puede eliminar.', 'No se puede eliminar');
      return;
    }
    if (!(await ui.showConfirmDialog('¿Eliminar el edificio "' + b.nombre + '"? Esta acción no se puede deshacer.', 'Eliminar edificio'))) return;
    db.edificios = db.edificios.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // ---------- Apartamentos ----------
  const searchUnidades = $('searchUnidades');
  const filterUnidadesEdificio = $('filterUnidadesEdificio');
  const filterUnidadesEstado = $('filterUnidadesEstado');
  [searchUnidades, filterUnidadesEdificio, filterUnidadesEstado].forEach(el => el.addEventListener('input', renderUnidades));

  function syncEdificioFilter(){
    const value = filterUnidadesEdificio.value;
    filterUnidadesEdificio.innerHTML = '<option value="">Todos los edificios</option>' +
      db.edificios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
        .map(b => '<option value="' + esc(b.id) + '">' + esc(b.nombre) + '</option>').join('');
    filterUnidadesEdificio.value = byId(db.edificios, value) ? value : '';
  }

  function renderUnidades(){
    syncEdificioFilter();
    const q = normalize(searchUnidades.value);
    const edificioId = filterUnidadesEdificio.value;
    const estado = filterUnidadesEstado.value;
    const el = $('tableUnidades');
    if (!db.unidades.length) {
      el.innerHTML = db.edificios.length
        ? emptyState('Todavía no hay apartamentos', 'Apartamentos, locales o casas.', '<button type="button" class="btn-brass" data-act="nueva-unidad">+ Nuevo apartamento</button>')
        : emptyState('Primero registra un edificio', 'Cada apartamento pertenece a un edificio.', '<button type="button" class="btn-brass" data-act="nuevo-edificio">+ Nuevo edificio</button>');
      return;
    }
    const rows = db.unidades.map(u => ({ u, c: activeContractOfUnit(u.id) }))
      .filter(({ u, c }) => {
        if (edificioId && u.edificioId !== edificioId) return false;
        if (estado === 'disponible' && c) return false;
        if (estado === 'ocupado' && !c) return false;
        if (!q) return true;
        const t = c ? byId(db.inquilinos, c.inquilinoId) : null;
        return normalize([unidadLabel(u), u.tipo, t && t.nombre].join(' ')).includes(q);
      })
      .sort((a, b) => unidadLabel(a.u).localeCompare(unidadLabel(b.u), undefined, { numeric:true }));
    if (!rows.length) { el.innerHTML = emptyState('Sin resultados', 'Ningún apartamento coincide con los filtros.'); return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Apartamento</th><th>Tipo</th><th class="num">Renta ref.</th><th>Estado</th><th>Inquilino actual</th><th></th></tr></thead><tbody>' +
      rows.map(({ u, c }) => {
        const b = edificioDe(u);
        const t = c ? byId(db.inquilinos, c.inquilinoId) : null;
        const detalles = [u.habitaciones ? plural(u.habitaciones, 'hab.', 'hab.') : '', u.banos ? plural(u.banos, 'baño', 'baños') : ''].filter(Boolean).join(' · ');
        return '<tr><td><span class="cell-main">' + esc(u.identificador) + '</span><span class="cell-sub">' + esc(b ? b.nombre : '(edificio eliminado)') + '</span></td>' +
          '<td>' + esc(u.tipo || '—') + (detalles ? '<span class="cell-sub">' + esc(detalles) + '</span>' : '') + '</td>' +
          '<td class="num">' + (u.renta != null ? fmtNumber(u.renta) : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (c ? badge('ocupado', 'Ocupado') : badge('disponible', 'Disponible')) + '</td>' +
          '<td>' + (t ? '<button type="button" class="link-btn" data-act="ver-inquilino" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button><span class="cell-sub">Hasta ' + esc(fmtDate(c.fechaFin)) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td><div class="row-actions">' +
            (c ? '<button type="button" class="btn-panel" data-act="editar-contrato" data-id="' + esc(c.id) + '">Contrato</button>'
               : '<button type="button" class="btn-brass" data-act="alquilar" data-id="' + esc(u.id) + '">Alquilar</button>') +
            '<button type="button" class="btn-panel" data-act="editar-unidad" data-id="' + esc(u.id) + '">Editar</button>' +
            '<button type="button" class="btn-wine" data-act="borrar-unidad" data-id="' + esc(u.id) + '">Eliminar</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  const TIPOS_UNIDAD = ['Apartamento', 'Casa', 'Local comercial', 'Oficina', 'Habitación', 'Otro'];

  function unidadFields(){
    return [
      { name:'edificioId', label:'Edificio', type:'select', required:true,
        options: db.edificios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(b => ({ value:b.id, label:b.nombre })) },
      { name:'identificador', label:'Apartamento / unidad', required:true, placeholder:'Ej: 3B' },
      { name:'piso', label:'Piso', type:'number', min:0, step:'1' },
      { name:'tipo', label:'Tipo', type:'select', options: TIPOS_UNIDAD.map(t => ({ value:t, label:t })) },
      { name:'propietarioId', label:'Propietario', type:'select', options: propietarioOptions('— El mismo del edificio —') },
      { name:'comisionTipo', label:'Comisión del abogado', type:'select', options: [{ value:'', label:'— La del edificio —' }].concat(COMISION_TIPOS) },
      { name:'comisionValor', label:'Valor de la comisión', type:'number', min:0, step:'0.01' },
      { name:'comisionMoneda', label:'Moneda (si es monto fijo)', type:'select', options: MONEDAS.map(m => ({ value:m, label:m })) },
      { name:'renta', label:'Renta mensual de referencia', type:'number', min:0, step:'0.01' },
      { name:'habitaciones', label:'Habitaciones', type:'number', min:0, step:'1' },
      { name:'banos', label:'Baños', type:'number', min:0, step:'0.5' },
      { name:'notas', label:'Notas', type:'textarea', full:true }
    ];
  }

  async function openUnidadForm(id, defaults){
    if (!db.edificios.length) {
      await ui.showNotice('Primero registra el edificio al que pertenece el apartamento.', 'Falta un edificio');
      openEdificioForm();
      return;
    }
    const current = id ? byId(db.unidades, id) : null;
    openForm({
      title: current ? 'Editar apartamento' : 'Nuevo apartamento',
      fields: unidadFields(),
      values: current || Object.assign({ tipo:'Apartamento' }, defaults),
      async onSave(values){
        const repetido = db.unidades.find(u => u.id !== (current && current.id) && u.edificioId === values.edificioId && normalize(u.identificador) === normalize(values.identificador));
        if (repetido) return 'Ya existe un apartamento "' + values.identificador + '" en ese edificio.';
        if (values.comisionTipo === 'porcentaje' && values.comisionValor > 100) return 'El porcentaje de comisión no puede ser mayor que 100.';
        values.propietarioId = values.propietarioId || null;
        if (!values.comisionTipo) { values.comisionTipo = null; values.comisionValor = null; values.comisionMoneda = null; }
        if (current) Object.assign(current, values);
        else db.unidades.push(Object.assign({ id: uid('apt'), creado: new Date().toISOString() }, values));
        return persist();
      }
    });
  }

  async function deleteUnidad(id){
    const u = byId(db.unidades, id);
    if (!u) return;
    const contratos = db.contratos.filter(c => c.unidadId === id);
    if (contratos.length) {
      await ui.showNotice('"' + unidadLabel(u) + '" tiene ' + plural(contratos.length, 'contrato registrado', 'contratos registrados') + '. Para conservar el historial no se puede eliminar.', 'No se puede eliminar');
      return;
    }
    if (!(await ui.showConfirmDialog('¿Eliminar el apartamento "' + unidadLabel(u) + '"?', 'Eliminar apartamento'))) return;
    db.unidades = db.unidades.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // ---------- Inquilinos ----------
  const searchInquilinos = $('searchInquilinos');
  searchInquilinos.addEventListener('input', renderInquilinos);

  function renderInquilinos(){
    const q = normalize(searchInquilinos.value);
    const el = $('tableInquilinos');
    if (!db.inquilinos.length) {
      el.innerHTML = emptyState('Todavía no hay inquilinos', 'Para asociarles sus contratos.', '<button type="button" class="btn-brass" data-act="nuevo-inquilino">+ Nuevo inquilino</button>');
      return;
    }
    const list = db.inquilinos
      .filter(t => !q || normalize([t.nombre, t.documento, t.telefono, t.email].join(' ')).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!list.length) { el.innerHTML = emptyState('Sin resultados', 'Ningún inquilino coincide con la búsqueda.'); return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Inquilino</th><th>Contacto</th><th>Vive en</th><th class="num">Contratos</th><th></th></tr></thead><tbody>' +
      list.map(t => {
        const contratos = contractsOfTenant(t.id);
        const activos = contratos.filter(isActive);
        return '<tr><td><button type="button" class="link-btn" data-act="ver-inquilino" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button>' +
            (t.documento ? '<span class="cell-sub">' + esc(t.documento) + '</span>' : '') + '</td>' +
          '<td>' + (t.telefono ? esc(t.telefono) : '<span class="muted">—</span>') + (t.email ? '<span class="cell-sub">' + esc(t.email) + '</span>' : '') + '</td>' +
          '<td>' + (activos.length ? activos.map(c => esc(unidadLabel(byId(db.unidades, c.unidadId)))).join('<br>') : '<span class="muted">Sin contrato activo</span>') + '</td>' +
          '<td class="num">' + contratos.length + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn-panel" data-act="ver-inquilino" data-id="' + esc(t.id) + '">Ficha</button>' +
            '<button type="button" class="btn-panel" data-act="contrato-inquilino" data-id="' + esc(t.id) + '">+ Contrato</button>' +
            '<button type="button" class="btn-wine" data-act="borrar-inquilino" data-id="' + esc(t.id) + '">Eliminar</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  const ESTADOS_CIVILES = ['Soltero/a', 'Casado/a', 'Unión libre', 'Divorciado/a', 'Viudo/a'];
  const INQUILINO_FIELDS = [
    { name:'nombre', label:'Nombre completo', required:true, full:true },
    { name:'documento', label:'Cédula / pasaporte', documento:'cedula', placeholder:'000-0000000-0' },
    { name:'nacionalidad', label:'Nacionalidad' },
    { name:'estadoCivil', label:'Estado civil', type:'select', options:[{ value:'', label:'—' }].concat(ESTADOS_CIVILES.map(e => ({ value:e, label:e }))) },
    { name:'ocupacion', label:'Ocupación / profesión' },
    { name:'telefono', label:'Teléfono', type:'tel' },
    { name:'email', label:'Correo electrónico', type:'email' },
    { name:'direccion', label:'Domicilio', full:true },
    { name:'notas', label:'Notas', type:'textarea', full:true, placeholder:'Referencias, contacto de emergencia, fiador...' }
  ];

  function openInquilinoForm(id, afterSave){
    const current = id ? byId(db.inquilinos, id) : null;
    openForm({
      title: current ? 'Editar inquilino' : 'Nuevo inquilino',
      fields: INQUILINO_FIELDS.map(f => f.name !== 'documento' ? f : Object.assign({}, f, {
        autocompletar: { tipo:'inquilino', excluir: current && current.id,
          campos: { nombre:'nombre', telefono:'telefono', email:'email', direccion:'direccion', nacionalidad:'nacionalidad', estadoCivil:'estadoCivil', ocupacion:'ocupacion' } }
      })),
      values: current || {},
      async onSave(values){
        if (values.documento) {
          const repetido = db.inquilinos.find(t => t.id !== (current && current.id) && claveDocumento(t.documento) === claveDocumento(values.documento));
          if (repetido) return 'Ya hay un inquilino registrado con el documento "' + values.documento + '": ' + repetido.nombre + '.';
        }
        let saved = current;
        if (current) Object.assign(current, values);
        else {
          saved = Object.assign({ id: uid('inq'), creado: new Date().toISOString() }, values);
          db.inquilinos.push(saved);
        }
        const ok = await persist();
        if (ok && afterSave) setTimeout(() => afterSave(saved), 0);
        return ok;
      }
    });
  }

  async function deleteInquilino(id){
    const t = byId(db.inquilinos, id);
    if (!t) return;
    const contratos = contractsOfTenant(id);
    if (contratos.length) {
      await ui.showNotice(t.nombre + ' tiene ' + plural(contratos.length, 'contrato registrado', 'contratos registrados') + '. Para conservar el historial no se puede eliminar.', 'No se puede eliminar');
      return;
    }
    if (!(await ui.showConfirmDialog('¿Eliminar a ' + t.nombre + '?', 'Eliminar inquilino'))) return;
    db.inquilinos = db.inquilinos.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // ---------- Ficha del inquilino ----------
  const tenantDetailOverlay = $('tenantDetailOverlay');
  const tenantDetailBody = $('tenantDetailBody');
  let tenantDetailId = null;

  function openTenantDetail(id){
    tenantDetailId = id;
    renderTenantDetail();
    tenantDetailOverlay.classList.add('show');
  }
  function closeTenantDetail(){
    tenantDetailId = null;
    tenantDetailOverlay.classList.remove('show');
  }

  function renderTenantDetail(){
    const t = byId(db.inquilinos, tenantDetailId);
    if (!t) { closeTenantDetail(); return; }
    const contratos = contractsOfTenant(t.id);
    const info = [
      ['Documento', t.documento], ['Nacionalidad', t.nacionalidad], ['Estado civil', t.estadoCivil],
      ['Ocupación', t.ocupacion], ['Teléfono', t.telefono], ['Correo', t.email],
      ['Domicilio', t.direccion, true], ['Notas', t.notas, true]
    ];
    const contratoIds = new Set(contratos.map(c => c.id));
    const pagos = db.pagos.filter(pg => contratoIds.has(pg.contratoId)).sort(comparePagos);
    const deudas = contratos.map(c => ({ c, d: deudaDe(c) })).filter(x => x.d.monto > 0);
    const deudaHtml = deudas.length
      ? deudas.map(({ c, d }) => '<div class="debt-row">' + badge('atrasado', 'Debe ' + fmtMoney(d.monto, c.moneda)) +
          '<span>' + esc(unidadLabel(byId(db.unidades, c.unidadId))) + ' · ' + plural(d.meses, 'mes atrasado', 'meses atrasados') + ' desde ' + esc(fmtPeriodo(d.primerPeriodo)) + '</span>' +
          '<button type="button" class="btn-panel" data-act="pagar" data-id="' + esc(c.id) + '" data-periodo="' + esc(d.primerPeriodo) + '">Registrar pago</button></div>').join('')
      : (contratos.some(isActive) ? '<div class="debt-row">' + badge('pagado', 'Al día') + '<span>No tiene pagos atrasados.</span></div>' : '');
    tenantDetailBody.innerHTML =
      '<div class="detail-head"><div><h3>' + esc(t.nombre) + '</h3><div class="modal-sub">' +
        plural(contratos.length, 'contrato', 'contratos') + ' · ' + plural(contratos.filter(isActive).length, 'activo', 'activos') + '</div></div></div>' +
      deudaHtml + casosDeInquilinoHtml(contratos) +
      '<dl class="detail-grid">' + info.map(([label, value, full]) =>
        '<div' + (full ? ' class="full"' : '') + '><dt>' + esc(label) + '</dt><dd>' + (value ? esc(value).replace(/\n/g, '<br>') : '—') + '</dd></div>').join('') + '</dl>' +
      '<h4 class="detail-section-title">Contratos</h4>' +
      (contratos.length
        ? '<div class="detail-table">' + contractsTable(contratos, false) + '</div>'
        : emptyState('Sin contratos', 'Este inquilino todavía no tiene contratos.')) +
      (contratos.length
        ? '<h4 class="detail-section-title" style="margin-top:20px;">Pagos</h4>' +
          (pagos.length ? '<div class="detail-table">' + pagosTable(pagos, false) + '</div>' : emptyState('Sin pagos', 'Todavía no hay pagos registrados para este inquilino.'))
        : '') +
      expedienteHtml(t);
    loadExpedienteFiles(t);
  }

  function casosDeInquilinoHtml(contratos){
    const ids = new Set(contratos.map(c => c.id));
    return db.casos.filter(k => ids.has(k.contratoId)).sort((a, b) => casoAbierto(b) - casoAbierto(a)).map(k =>
      '<div class="debt-row">' + (casoAbierto(k) ? badge('proximo', 'Caso abierto') : badge('finalizado', 'Caso cerrado')) +
      '<span>' + esc(tipoCasoLabel(k.tipo)) + ' · ' + esc(casoAbierto(k) ? etapaLabel(k.etapa) : resultadoLabel(k.resultado)) + '</span>' +
      '<button type="button" class="btn-panel" data-act="ver-caso" data-id="' + esc(k.id) + '">Ver caso</button></div>').join('');
  }

  // ---------- Expediente: seguimiento y archivos ----------
  // t.seguimiento: [{ id, fecha (ISO), texto }] — notas fechadas (llamadas,
  // acuerdos de pago, recordatorios enviados...).
  // Los archivos viven en <carpeta de trabajo>/Expedientes/<t.expedienteCarpeta>.
  function expedienteHtml(t){
    const notas = (t.seguimiento || []).slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
    return '<div class="exp-grid">' +
      '<section><h4 class="detail-section-title">Seguimiento</h4>' +
        '<div class="note-add"><textarea id="notaTexto" rows="2" placeholder="Llamada, acuerdo de pago, visita..."></textarea>' +
        '<button type="button" class="btn-brass" data-act="nota-agregar" data-id="' + esc(t.id) + '">Añadir nota</button></div>' +
        (notas.length ? '<ul class="note-list">' + notas.map(n => '<li><div><span class="note-date">' + esc(new Date(n.fecha).toLocaleString([], { dateStyle:'short', timeStyle:'short' })) + '</span>' +
          '<p>' + esc(n.texto).replace(/\n/g, '<br>') + '</p></div>' +
          '<button type="button" class="icon-x" data-act="nota-borrar" data-id="' + esc(n.id) + '" title="Eliminar nota" aria-label="Eliminar nota">✕</button></li>').join('') + '</ul>'
          : '<div class="no-fields">Sin notas todavía.</div>') +
      '</section>' +
      '<section><h4 class="detail-section-title">Archivos del expediente</h4>' +
        '<div class="exp-actions"><button type="button" class="btn-panel" data-act="exp-adjuntar" data-id="' + esc(t.id) + '">Adjuntar archivos…</button>' +
        '<button type="button" class="btn-panel" data-act="exp-carpeta" data-id="' + esc(t.id) + '"' + (t.expedienteCarpeta ? '' : ' disabled') + '>Abrir carpeta</button></div>' +
        '<div id="expFiles" class="exp-files"><div class="no-fields">Cargando…</div></div>' +
      '</section></div>';
  }

  async function loadExpedienteFiles(t){
    const el = $('expFiles');
    if (!el) return;
    if (!window.rcExpediente) { el.innerHTML = '<div class="no-fields">Disponible solo en la aplicación de escritorio.</div>'; return; }
    if (!(ed.hasWorkFolder && ed.hasWorkFolder())) { el.innerHTML = '<div class="no-fields">Elige una carpeta de trabajo en el Redactor para guardar archivos (cédula escaneada, contrato firmado...).</div>'; return; }
    if (!t.expedienteCarpeta) { el.innerHTML = '<div class="no-fields">Sin archivos todavía.</div>'; return; }
    const result = await window.rcExpediente.list(t.expedienteCarpeta);
    if (tenantDetailId !== t.id || !$('expFiles')) return;
    const files = result.ok ? result.files : [];
    $('expFiles').innerHTML = files.length
      ? files.map(f => '<div class="exp-file"><button type="button" class="link-btn" data-act="exp-abrir" data-id="' + esc(f.name) + '" title="Abrir">' + esc(f.name) + '</button>' +
          '<span class="lib-sub">' + esc(new Date(f.mtime).toLocaleDateString()) + ' · ' + esc(f.size >= 1048576 ? (f.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(f.size / 1024)) + ' KB') + '</span>' +
          '<button type="button" class="icon-x" data-act="exp-borrar" data-id="' + esc(f.name) + '" title="Mover a la papelera" aria-label="Eliminar archivo">✕</button></div>').join('')
      : '<div class="no-fields">Sin archivos todavía.</div>';
  }

  async function registrarSeguimiento(inquilinoId, texto){
    const t = byId(db.inquilinos, inquilinoId);
    if (!t || !String(texto || '').trim()) return;
    t.seguimiento = (t.seguimiento || []).concat({ id: uid('nota'), fecha: new Date().toISOString(), texto: String(texto).trim() });
    await persist();
    if (tenantDetailId === inquilinoId) renderTenantDetail();
  }

  async function borrarNota(notaId){
    const t = byId(db.inquilinos, tenantDetailId);
    if (!t) return;
    if (!(await ui.showConfirmDialog('¿Eliminar esta nota del seguimiento?', 'Eliminar nota'))) return;
    t.seguimiento = (t.seguimiento || []).filter(n => n.id !== notaId);
    await persist();
    renderTenantDetail();
  }

  // Da nombre a la carpeta del expediente del inquilino la primera vez.
  async function asegurarCarpetaExpediente(t){
    if (!(ed.hasWorkFolder && ed.hasWorkFolder())) {
      await ui.showNotice('Los archivos del expediente se guardan en la carpeta de trabajo. Elígela primero en el Redactor.', 'Falta la carpeta de trabajo');
      return false;
    }
    if (!t.expedienteCarpeta) {
      const base = t.nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\\/:*?"<>|.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Inquilino';
      t.expedienteCarpeta = base + ' - ' + t.id.slice(-6);
      await persist();
    }
    return true;
  }

  async function adjuntarExpediente(inquilinoId){
    const t = byId(db.inquilinos, inquilinoId);
    if (!t || !window.rcExpediente) return;
    if (!(await asegurarCarpetaExpediente(t))) return;
    const result = await window.rcExpediente.add(t.expedienteCarpeta);
    if (!result.ok) { await ui.showNotice('No se pudieron adjuntar los archivos: ' + result.error); return; }
    if (result.added.length) await registrarSeguimiento(t.id, 'Archivos adjuntados: ' + result.added.join(', ') + '.');
    else renderTenantDetail();
  }

  async function borrarArchivoExpediente(nombre){
    const t = byId(db.inquilinos, tenantDetailId);
    if (!t || !t.expedienteCarpeta) return;
    if (!(await ui.showConfirmDialog('¿Mover "' + nombre + '" a la papelera de reciclaje?', 'Eliminar archivo'))) return;
    const result = await window.rcExpediente.trash(t.expedienteCarpeta, nombre);
    if (!result.ok) await ui.showNotice('No se pudo eliminar el archivo: ' + result.error);
    loadExpedienteFiles(t);
  }

  $('tenantDetailClose').addEventListener('click', closeTenantDetail);
  $('tenantDetailEdit').addEventListener('click', () => openInquilinoForm(tenantDetailId));
  $('tenantDetailNewContract').addEventListener('click', () => openContratoForm(null, { inquilinoId: tenantDetailId }));

  // ---------- Contratos ----------
  const searchContratos = $('searchContratos');
  const filterContratosEstado = $('filterContratosEstado');
  [searchContratos, filterContratosEstado].forEach(el => el.addEventListener('input', renderContratos));

  function contractsTable(list, showTenant){
    return '<table class="data-table"><thead><tr>' + (showTenant ? '<th>Inquilino</th>' : '') +
      '<th>Apartamento</th><th>Periodo</th><th class="num">Monto mensual</th><th>Estado</th><th>Documento</th><th></th></tr></thead><tbody>' +
      list.map(c => {
        const inquilinos = inquilinosDe(c);
        const t = inquilinos[0];
        const s = contractStatus(c);
        const dep = depositoEstado(c);
        const debe = deudaDe(c).monto > 0;
        const caso = casoDeContrato(c.id);
        return '<tr>' +
          (showTenant ? '<td>' + (t ? '<button type="button" class="link-btn" data-act="ver-inquilino" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button>' : '<span class="muted">(eliminado)</span>') +
            (inquilinos.length > 1 ? '<span class="cell-sub">y ' + esc(inquilinos.slice(1).map(x => x.nombre).join(', ')) + '</span>' : '') + '</td>' : '') +
          '<td>' + esc(unidadLabel(byId(db.unidades, c.unidadId))) + (c.renovadoDe ? '<span class="cell-sub">Renovación</span>' : '') + '</td>' +
          '<td><span class="nowrap">' + esc(fmtDate(c.fechaInicio)) + ' – ' + esc(fmtDate(c.fechaFin)) + '</span><span class="cell-sub">' + (monthsOf(c.fechaInicio, c.fechaFin) ? plural(monthsOf(c.fechaInicio, c.fechaFin), 'mes', 'meses') : '') + (c.diaPago ? ' · paga el día ' + esc(c.diaPago) : '') + '</span></td>' +
          '<td class="num">' + esc(fmtMoney(c.monto, c.moneda)) + (Number(c.itbis) > 0 ? '<span class="cell-sub">+ ITBIS ' + esc(fmtNumber(c.itbis).replace(/[.,]00$/, '')) + '%</span>' : '') +
            (proximoAumento(c) ? '<span class="cell-sub">Aumento ' + esc(fmtPeriodo(proximoAumento(c).periodo)) + '</span>' : '') + (dep ? '<span class="cell-sub">Depósito: ' + esc(dep.label) + '</span>' : '') + '</td>' +
          '<td>' + badge(s.key, s.label) + (c.renovadoA ? '<span class="cell-sub">Renovado</span>' : '') + (caso ? '<span class="cell-sub caso-flag">En caso: ' + esc(etapaLabel(caso.etapa)) + '</span>' : '') + '</td>' +
          '<td>' + (c.firmado
              ? '<button type="button" class="link-btn" data-act="ver-firmado" data-id="' + esc(c.id) + '" title="Abrir el contrato firmado">Firmado ✓</button><span class="cell-sub">Subido el ' + esc(new Date(c.firmado.fecha).toLocaleDateString()) + '</span>'
              : c.documentoHtml ? '<span class="cell-main">Redactado</span><span class="cell-sub">' + esc(c.documentoActualizado ? new Date(c.documentoActualizado).toLocaleDateString() : '') + ' · sin firmar</span>'
              : '<span class="muted">Pendiente</span>') + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn-brass" data-act="documento" data-id="' + esc(c.id) + '">' + (c.documentoHtml ? 'Abrir documento' : 'Redactar') + '</button>' +
            '<button type="button" class="btn-panel" data-act="editar-contrato" data-id="' + esc(c.id) + '">Editar</button>' +
            rowMenu([
              c.documentoHtml && { act:'contrato-pdf', id:c.id, label:'Contrato en PDF' },
              { act:'subir-firmado', id:c.id, label: c.firmado ? 'Reemplazar contrato firmado…' : 'Subir contrato firmado…' },
              c.firmado && { act:'ver-firmado', id:c.id, label:'Ver contrato firmado' },
              !c.renovadoA && { act:'renovar', id:c.id, label:'Renovar contrato…' },
              Number(c.deposito) > 0 && { act:'deposito', id:c.id, label:'Depósito…' },
              { act:'estado-cuenta-inquilino', id:c.id, label:'Estado de cuenta' },
              debe && { act:'recordar', id:c.id, label:'Enviar recordatorio de pago' },
              isActive(c) && { act:'aumento', id:c.id, label:'Aplicar aumento…' },
              { act:'acta', id:c.id + '|entrega', label: actaDe(c.id, 'entrega') ? 'Ver acta de entrega' : 'Acta de entrega…' },
              (actaDe(c.id, 'entrega') || !isActive(c) || actaDe(c.id, 'devolucion')) && { act:'acta', id:c.id + '|devolucion', label: actaDe(c.id, 'devolucion') ? 'Ver acta de devolución' : 'Acta de devolución…' },
              caso ? { act:'ver-caso', id:caso.id, label:'Ver caso de cobro' } : (debe && { act:'abrir-caso', id:c.id, label:'Abrir caso de cobro…' }),
              isActive(c) && { act:'finalizar', id:c.id, label:'Finalizar contrato' },
              { act:'borrar-contrato', id:c.id, label:'Eliminar', danger:true }
            ]) +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function renderContratos(){
    const q = normalize(searchContratos.value);
    const estado = filterContratosEstado.value;
    const el = $('tableContratos');
    if (!db.contratos.length) {
      el.innerHTML = emptyState('Todavía no hay contratos', 'Une un inquilino con un apartamento.', '<button type="button" class="btn-brass" data-act="nuevo-contrato">+ Nuevo contrato</button>');
      return;
    }
    const list = db.contratos.filter(c => {
      const s = contractStatus(c).key;
      if (estado === 'activos' && !isActive(c)) return false;
      if (estado === 'atencion' && s !== 'vencido' && s !== 'por-vencer') return false;
      if (estado === 'finalizado' && isActive(c)) return false;
      if (!q) return true;
      return normalize([...inquilinosDe(c).map(t => t.nombre + ' ' + (t.documento || '')), unidadLabel(byId(db.unidades, c.unidadId))].join(' ')).includes(q);
    }).sort((a, b) => (isActive(b) - isActive(a)) || (b.fechaInicio || '').localeCompare(a.fechaInicio || ''));
    el.innerHTML = list.length ? contractsTable(list, true) : emptyState('Sin resultados', 'Ningún contrato coincide con los filtros.');
  }

  const MONEDAS = ['RD$', 'US$', '€', '$'];

  function contratoFields(current){
    // Solo se ofrecen los apartamentos libres (y el del propio contrato al editarlo).
    const unidades = db.unidades
      .filter(u => (current && current.unidadId === u.id) || !activeContractOfUnit(u.id))
      .sort((a, b) => unidadLabel(a).localeCompare(unidadLabel(b), undefined, { numeric:true }));
    return [
      { name:'inquilinoId', label:'Inquilino', type:'select', required:true, full:true,
        options: db.inquilinos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(t => ({ value:t.id, label:t.nombre + (t.documento ? ' — ' + t.documento : '') })) },
      { name:'unidadId', label:'Apartamento', type:'select', required:true, full:true,
        options: unidades.map(u => ({ value:u.id, label:unidadLabel(u) })),
        help: unidades.length ? 'Solo se muestran los apartamentos sin un contrato activo.' : 'No hay apartamentos disponibles: finaliza un contrato o registra un apartamento nuevo.' },
      { name:'fechaInicio', label:'Fecha de inicio', type:'date', required:true },
      { name:'fechaFin', label:'Fecha de fin', type:'date', required:true },
      { name:'moneda', label:'Moneda', type:'select', options: MONEDAS.map(m => ({ value:m, label:m })) },
      { name:'monto', label:'Alquiler mensual', type:'number', required:true, min:0, step:'0.01' },
      { name:'deposito', label:'Depósito', type:'number', min:0, step:'0.01' },
      { name:'diaPago', label:'Día de pago (1-31)', type:'number', min:1, max:31, step:'1' },
      { name:'estado', label:'Estado', type:'select', options:[{ value:'activo', label:'Activo' }, { value:'finalizado', label:'Finalizado' }] },
      { name:'cotitulares', label:'Otros inquilinos que firman el contrato', type:'checks', full:true,
        options: db.inquilinos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(t => ({ value:t.id, label:t.nombre + (t.documento ? ' — ' + t.documento : '') })),
        help:'Opcional.' },
      { name:'_mora', type:'heading', label:'Recargo por mora' },
      { name:'moraTipo', label:'Tipo de recargo', type:'select', options:[{ value:'ninguna', label:'Sin recargo' }, { value:'porcentaje', label:'Porcentaje de la cuota' }, { value:'fijo', label:'Monto fijo' }] },
      { name:'moraValor', label:'Valor del recargo', type:'number', min:0, step:'0.01' },
      { name:'moraGracia', label:'Días de gracia', type:'number', min:0, max:60, step:'1' },
      { name:'_aumento', type:'heading', label:'Aumento e impuestos', help:'Opcional.' },
      { name:'aumentoPct', label:'Aumento anual (%)', type:'number', min:0, max:100, step:'0.01' },
      { name:'aumentoCada', label:'Cada cuántos meses', type:'number', min:1, max:60, step:'1' },
      { name:'itbis', label:'ITBIS sobre el alquiler (%)', type:'number', min:0, max:100, step:'0.01', help:'Normalmente 18.' },
      { name:'retencionIsr', label:'Retención de ISR del inquilino (%)', type:'number', min:0, max:100, step:'0.01', help:'Normalmente 10.' },
      { name:'_fiador', type:'heading', label:'Fiador o garante', help:'Opcional.' },
      { name:'fiadorNombre', label:'Nombre del fiador' },
      { name:'fiadorDocumento', label:'Cédula del fiador', documento:'cedula', placeholder:'000-0000000-0',
        autocompletar: { tipo:'fiador', excluir: current && current.id,
          campos: { nombre:'fiadorNombre', telefono:'fiadorTelefono', direccion:'fiadorDireccion' } } },
      { name:'fiadorTelefono', label:'Teléfono del fiador', type:'tel' },
      { name:'fiadorDireccion', label:'Domicilio del fiador' },
      { name:'notas', label:'Notas', type:'textarea', full:true, placeholder:'Condiciones especiales, mascotas...' }
    ];
  }

  async function openContratoForm(id, defaults){
    if (!db.inquilinos.length) {
      if (await ui.showConfirmDialog('Para crear un contrato primero hay que registrar al inquilino. ¿Registrarlo ahora?', 'Falta el inquilino')) {
        openInquilinoForm(null, (t) => openContratoForm(null, Object.assign({}, defaults, { inquilinoId: t.id })));
      }
      return;
    }
    if (!db.unidades.length) {
      await ui.showNotice('Para crear un contrato primero registra el apartamento que se alquila.', 'Falta el apartamento');
      openUnidadForm();
      return;
    }
    const current = id ? byId(db.contratos, id) : null;
    const values = current || Object.assign({ moneda: ajuste('moneda'), estado:'activo', diaPago: ajuste('diaPago'), moraTipo: ajuste('moraTipo'), moraValor: ajuste('moraValor'), moraGracia: ajuste('moraGracia') }, defaults);
    if (!current && values.unidadId && values.monto == null) {
      const u = byId(db.unidades, values.unidadId);
      if (u && u.renta != null) values.monto = u.renta;
    }
    openForm({
      title: current ? 'Editar contrato' : 'Nuevo contrato',
      subtitle: current ? 'Inquilino: ' + ((byId(db.inquilinos, current.inquilinoId) || {}).nombre || '—') : 'Une a un inquilino con un apartamento durante un periodo.',
      fields: contratoFields(current),
      values,
      onInput(form, name){
        const get = (n) => form.querySelector('[name="' + n + '"]');
        if (name === 'fechaInicio' && get('fechaInicio').value && !get('fechaFin').value) {
          get('fechaFin').value = addDays(addMonths(get('fechaInicio').value, ajuste('duracionMeses')), -1);
        }
        if (name === 'unidadId' && !get('monto').value) {
          const u = byId(db.unidades, get('unidadId').value);
          if (u && u.renta != null) get('monto').value = u.renta;
        }
      },
      async onSave(values){
        if (values.fechaFin < values.fechaInicio) return 'La fecha de fin no puede ser anterior a la de inicio.';
        if (values.diaPago != null && (values.diaPago < 1 || values.diaPago > 31)) return 'El día de pago debe estar entre 1 y 31.';
        if (values.moraTipo === 'porcentaje' && values.moraValor > 100) return 'El recargo por mora no puede ser mayor que el 100% de la cuota.';
        if (values.moraTipo !== 'ninguna' && !(values.moraValor > 0)) return 'Indica el valor del recargo por mora, o elige "Sin recargo".';
        values.cotitulares = (values.cotitulares || []).filter(id => id !== values.inquilinoId);
        if (values.estado !== 'finalizado') {
          const otro = activeContractOfUnit(values.unidadId, current && current.id);
          if (otro) {
            const t = byId(db.inquilinos, otro.inquilinoId);
            return 'Ese apartamento ya tiene un contrato activo' + (t ? ' con ' + t.nombre : '') + '. Finalízalo antes de crear uno nuevo.';
          }
        }
        if (current && current.montos && current.montos.length && values.monto !== current.monto) {
          // Cambiar el monto a mano corrige el último tramo del historial de aumentos.
          current.montos[current.montos.length - 1].monto = values.monto;
        }
        if (current) {
          if (current.estado !== 'finalizado' && values.estado === 'finalizado') values.fechaFinalizacion = todayStr();
          if (values.estado !== 'finalizado') values.fechaFinalizacion = null;
          Object.assign(current, values);
        } else {
          db.contratos.push(Object.assign({ id: uid('ctr'), creado: new Date().toISOString(), documentoHtml: null }, values));
        }
        return persist();
      }
    });
  }

  async function finalizeContrato(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    const t = byId(db.inquilinos, c.inquilinoId);
    const ok = await ui.showConfirmDialog('¿Finalizar el contrato de ' + (t ? t.nombre : 'este inquilino') + ' en ' + unidadLabel(byId(db.unidades, c.unidadId)) + '? El apartamento quedará disponible. El contrato se conserva en el historial.', 'Finalizar contrato');
    if (!ok) return;
    c.estado = 'finalizado';
    c.fechaFinalizacion = todayStr();
    await persist();
    renderActive();
  }

  async function deleteContrato(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    const t = byId(db.inquilinos, c.inquilinoId);
    const pagos = db.pagos.filter(pg => pg.contratoId === id).length;
    if (db.casos.some(k => k.contratoId === id)) {
      await ui.showNotice('Este contrato tiene un caso de cobro o desalojo. Para conservar su historial no se puede eliminar; usa "Finalizar" si ya terminó.', 'No se puede eliminar');
      return;
    }
    if (pagos) {
      await ui.showNotice('Este contrato tiene ' + plural(pagos, 'pago registrado', 'pagos registrados') + '. Para conservar la contabilidad no se puede eliminar; usa "Finalizar" si ya terminó.', 'No se puede eliminar');
      return;
    }
    const ok = await ui.showConfirmDialog('¿Eliminar definitivamente el contrato de ' + (t ? t.nombre : 'este inquilino') + ' en ' + unidadLabel(byId(db.unidades, c.unidadId)) + '?' + (c.documentoHtml ? ' También se borrará su documento redactado.' : '') + ' Si el contrato terminó, es mejor usar "Finalizar" para conservar el historial.', 'Eliminar contrato');
    if (!ok) return;
    db.contratos = db.contratos.filter(x => x.id !== id);
    if (linkedContractId === id) linkedContractId = null;
    await persist();
    renderActive();
  }

  // ---------- Depósito ----------
  // c.deposito es el monto acordado; c.depositoInfo guarda qué pasó con él:
  // { fechaRecibido, fechaLiquidacion, devuelto, retenido, motivo,
  //   aplicadoDeuda, trasladadoA }.
  function depositoEstado(c){
    if (!(Number(c.deposito) > 0)) return null;
    const info = c.depositoInfo || {};
    if (info.trasladadoA) return { key:'trasladado', label:'pasó al contrato renovado' };
    if (info.fechaLiquidacion) {
      return { key:'liquidado', label:'liquidado: devuelto ' + fmtMoney(info.devuelto || 0, c.moneda) + (info.retenido ? ', retenido ' + fmtMoney(info.retenido, c.moneda) : '') };
    }
    if (info.fechaRecibido) return { key:'custodia', label:fmtMoney(c.deposito, c.moneda) + ' en custodia' };
    return { key:'pendiente', label:fmtMoney(c.deposito, c.moneda) + ' sin recibir' };
  }

  // Reparte un monto entre las cuotas vencidas más antiguas creando pagos
  // (por ejemplo, el depósito retenido). Devuelve cuánto se aplicó.
  function aplicarADeuda(c, monto, fecha, metodo, referencia){
    let resto = round2(monto);
    const partes = [];
    for (const q of deudaDe(c).cuotas) {
      if (resto <= 0) break;
      const parte = round2(Math.min(resto, q.saldo));
      partes.push({ p: q.p, monto: parte });
      resto = round2(resto - parte);
    }
    // Un solo recibo para todo lo aplicado.
    const numero = siguienteNumeroRecibo();
    const grupo = partes.length > 1 ? uid('grp') : null;
    const creado = new Date().toISOString();
    partes.forEach(x => db.pagos.push({ id: uid('pag'), numero, creado, grupo, contratoId: c.id, periodo: x.p, fecha, monto: x.monto, moneda: c.moneda, metodo, referencia }));
    return round2(monto - resto);
  }

  function openDepositoForm(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    const info = c.depositoInfo || {};
    if (info.trasladadoA) {
      ui.showNotice('Este depósito pasó al contrato renovado. Gestiónalo desde ese contrato.', 'Depósito');
      return;
    }
    const deuda = deudaDe(c);
    const fields = [
      { name:'deposito', label:'Depósito acordado', type:'number', required:true, min:0, step:'0.01' },
      { name:'fechaRecibido', label:'Fecha en que se recibió', type:'date' },
      { name:'_fin', type:'heading', label:'Al terminar el contrato' },
      { name:'fechaLiquidacion', label:'Fecha de devolución', type:'date' },
      { name:'devuelto', label:'Monto devuelto', type:'number', min:0, step:'0.01' },
      { name:'retenido', label:'Monto retenido', type:'number', min:0, step:'0.01' },
      { name:'motivo', label:'Motivo de la retención', type:'textarea', full:true, placeholder:'Daños, deuda pendiente, servicios sin pagar...' }
    ];
    if (deuda.monto > 0 && !info.aplicadoDeuda) {
      fields.push({ name:'aplicarDeuda', label:'Aplicar lo retenido a la deuda (' + fmtMoney(deuda.monto, c.moneda) + ')', type:'checkbox', full:true });
    }
    openForm({
      title: 'Depósito del contrato',
      subtitle: contractTitle(c) + (info.aplicadoDeuda ? ' · ya se aplicaron ' + fmtMoney(info.aplicadoDeuda, c.moneda) + ' a la deuda' : ''),
      fields,
      values: Object.assign({ deposito: c.deposito }, info),
      async onSave(values){
        const devuelto = values.devuelto || 0;
        const retenido = values.retenido || 0;
        if (round2(devuelto + retenido) > values.deposito + 0.005) return 'Lo devuelto más lo retenido no puede superar el depósito (' + fmtMoney(values.deposito, c.moneda) + ').';
        if ((devuelto || retenido) && !values.fechaLiquidacion) return 'Indica la fecha de devolución del depósito.';
        if (retenido && !values.motivo) return 'Indica el motivo de la retención: queda como constancia.';
        let aplicado = info.aplicadoDeuda || 0;
        if (values.aplicarDeuda && retenido > 0) {
          aplicado = aplicarADeuda(c, Math.min(retenido, deuda.monto), values.fechaLiquidacion, 'Depósito', 'Depósito retenido');
        }
        c.deposito = values.deposito;
        c.depositoInfo = {
          fechaRecibido: values.fechaRecibido || null,
          fechaLiquidacion: values.fechaLiquidacion || null,
          devuelto: values.devuelto, retenido: values.retenido,
          motivo: values.motivo || '',
          aplicadoDeuda: aplicado || null
        };
        return persist();
      }
    });
  }

  // ---------- Renovación ----------
  // Crea un contrato nuevo a continuación del actual (mismo inquilino,
  // apartamento, fiador y condiciones), con el aumento indicado, y
  // finaliza el actual. El depósito pasa al contrato nuevo.
  function openRenovarForm(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    const inicio = c.fechaFin ? addDays(c.fechaFin, 1) : todayStr();
    openForm({
      title: 'Renovar contrato',
      subtitle: contractTitle(c) + ' · hoy ' + fmtMoney(c.monto, c.moneda) + ' al mes, hasta el ' + fmtDate(c.fechaFin) + '.',
      fields: [
        { name:'fechaInicio', label:'Inicio del nuevo periodo', type:'date', required:true },
        { name:'fechaFin', label:'Fin del nuevo periodo', type:'date', required:true },
        { name:'aumento', label:'Aumento (%)', type:'number', min:0, max:100, step:'0.01' },
        { name:'monto', label:'Nuevo alquiler mensual', type:'number', required:true, min:0, step:'0.01' },
        { name:'diaPago', label:'Día de pago (1-31)', type:'number', min:1, max:31, step:'1' },
        { name:'notas', label:'Notas', type:'textarea', full:true }
      ],
      values: { fechaInicio: inicio, fechaFin: addDays(addMonths(inicio, ajuste('duracionMeses')), -1), aumento: 0, monto: c.monto, diaPago: c.diaPago, notas: c.notas },
      onInput(form, name){
        const get = (n) => form.querySelector('[name="' + n + '"]');
        if (name === 'aumento') get('monto').value = round2((Number(c.monto) || 0) * (1 + (Number(get('aumento').value) || 0) / 100));
        if (name === 'fechaInicio' && get('fechaInicio').value) get('fechaFin').value = addDays(addMonths(get('fechaInicio').value, ajuste('duracionMeses')), -1);
      },
      async onSave(values){
        if (values.fechaFin < values.fechaInicio) return 'La fecha de fin no puede ser anterior a la de inicio.';
        if (c.fechaInicio && values.fechaInicio <= c.fechaInicio) return 'El nuevo periodo debe empezar después del inicio del contrato actual (' + fmtDate(c.fechaInicio) + ').';
        const otro = activeContractOfUnit(c.unidadId, c.id);
        if (otro) return 'El apartamento ya tiene otro contrato activo.';
        // Si el depósito ya se devolvió, el contrato nuevo empieza con uno sin recibir.
        const depositoLiquidado = !!(c.depositoInfo && c.depositoInfo.fechaLiquidacion);
        const nuevo = Object.assign({}, c, {
          id: uid('ctr'), creado: new Date().toISOString(),
          fechaInicio: values.fechaInicio, fechaFin: values.fechaFin, monto: values.monto, diaPago: values.diaPago, notas: values.notas,
          estado: 'activo', fechaFinalizacion: null, documentoHtml: null, documentoActualizado: null,
          recargosCondonados: [], renovadoDe: c.id,
          depositoInfo: c.depositoInfo && !depositoLiquidado ? Object.assign({}, c.depositoInfo, { trasladadoA: null }) : null
        });
        delete nuevo.renovadoA;
        c.estado = 'finalizado';
        c.fechaFinalizacion = c.fechaFin && c.fechaFin < values.fechaInicio ? c.fechaFin : addDays(values.fechaInicio, -1);
        c.renovadoA = nuevo.id;
        if (Number(c.deposito) > 0 && !depositoLiquidado) c.depositoInfo = Object.assign({}, c.depositoInfo, { trasladadoA: nuevo.id });
        db.contratos.push(nuevo);
        const ok = await persist();
        if (ok) setTimeout(() => ui.showNotice('Contrato renovado del ' + fmtDate(values.fechaInicio) + ' al ' + fmtDate(values.fechaFin) + ' por ' + fmtMoney(values.monto, c.moneda) +
          ' al mes. Puedes redactar su documento desde la lista de contratos.', 'Contrato renovado'), 0);
        return ok;
      }
    });
  }

  async function toggleRecargo(id, periodo, condonar){
    const c = byId(db.contratos, id);
    if (!c || !periodo) return;
    if (condonar) {
      const q = cuota(c, periodo);
      if (!(await ui.showConfirmDialog('¿Condonar el recargo de ' + fmtMoney(q.recargo, c.moneda) + ' de ' + fmtPeriodo(periodo) + '?', 'Condonar recargo'))) return;
    }
    const lista = new Set(c.recargosCondonados || []);
    if (condonar) lista.add(periodo); else lista.delete(periodo);
    c.recargosCondonados = [...lista];
    await persist();
    renderActive();
  }

  // ---------- Estado de cuenta del inquilino (imprimible) ----------
  // Mes a mes desde el inicio del contrato hasta hoy: cuota, recargo,
  // pagado y saldo, con la deuda vencida al final. Sirve de base para una
  // intimación de pago.
  async function printEstadoCuentaInquilino(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    const u = byId(db.unidades, c.unidadId);
    const b = edificioDe(u) || {};
    const p = propietarioDe(u) || {};
    const hoy = todayStr();
    const cuotas = periodsUntil(c, monthOf(hoy)).map(per => cuota(c, per));
    const deuda = deudaDe(c);
    const money = (n) => esc(fmtMoney(n, c.moneda));
    const th = (t, right) => '<th style="text-align:' + (right ? 'right' : 'left') + ';border-bottom:1.5px solid #333;padding:5px 6px;font-size:9.5pt;">' + t + '</th>';
    const td = (t, right, extra) => '<td style="text-align:' + (right ? 'right' : 'left') + ';border-bottom:1px solid #ddd;padding:4px 6px;font-size:10pt;white-space:nowrap;' + (extra || '') + '">' + t + '</td>';
    const totales = cuotas.reduce((s, q) => ({ monto: s.monto + q.monto, recargo: s.recargo + q.recargo, pagado: s.pagado + q.pagado, saldo: s.saldo + q.saldo }), { monto:0, recargo:0, pagado:0, saldo:0 });
    const filas = cuotas.map(q => '<tr>' + td(esc(fmtPeriodo(q.p))) + td(esc(fmtDate(q.vence))) + td(money(q.monto), true) +
      td(q.recargo ? money(q.recargo) : '—', true) + td(q.pagado ? money(q.pagado) : '—', true) + td(q.saldo ? money(q.saldo) : '—', true, q.saldo && q.vence < hoy ? 'font-weight:bold;' : '') +
      td(esc(q.label)) + '</tr>').join('');
    const pagos = db.pagos.filter(pg => pg.contratoId === c.id).sort((a, x) => (a.fecha || '').localeCompare(x.fecha || ''));
    const bodyHtml =
      '<div style="max-width:720px;margin:0 auto;font-size:10.5pt;">' +
        '<table style="width:100%;border-collapse:collapse;"><tr>' +
          '<td style="vertical-align:top;"><div style="font-size:16pt;font-weight:bold;letter-spacing:.03em;">ESTADO DE CUENTA DEL INQUILINO</div>' +
            '<div style="color:#444;">' + esc(b.nombre || '') + (b.direccion ? ' · ' + esc(b.direccion) : '') + '</div>' + lineaDespacho() + '</td>' +
          '<td style="vertical-align:top;text-align:right;color:#444;">Al ' + esc(fmtDate(hoy)) + '</td>' +
        '</tr></table>' +
        '<table style="width:100%;margin:14px 0;border:1px solid #999;border-collapse:collapse;font-size:10pt;">' +
          '<tr><td style="padding:6px 10px;width:50%;vertical-align:top;"><b>Inquilino(s):</b> ' + esc(inquilinosDe(c).map(t => t.nombre + (t.documento ? ' (' + t.documento + ')' : '')).join('; ')) +
            (c.fiadorNombre ? '<br><b>Fiador:</b> ' + esc(c.fiadorNombre) + (c.fiadorDocumento ? ' (' + esc(c.fiadorDocumento) + ')' : '') : '') + '</td>' +
          '<td style="padding:6px 10px;vertical-align:top;"><b>Inmueble:</b> ' + esc(unidadLabel(u)) +
            '<br><b>Propietario:</b> ' + esc(p.nombre || '—') +
            '<br><b>Contrato:</b> ' + esc(fmtDate(c.fechaInicio)) + ' – ' + esc(fmtDate(c.fechaFin)) + ' · ' + money(c.monto) + ' al mes, día ' + esc(c.diaPago || 1) +
            (hasMora(c) ? '<br><b>Mora:</b> ' + esc(moraLabel(c)) : '') + '</td></tr>' +
        '</table>' +
        '<table style="width:100%;border-collapse:collapse;"><tr>' + th('Mes') + th('Vence') + th('Cuota', true) + th('Recargo', true) + th('Pagado', true) + th('Saldo', true) + th('Estado') + '</tr>' + filas +
          '<tr>' + td('<b>Total</b>') + td('') + td('<b>' + money(totales.monto) + '</b>', true) + td('<b>' + money(totales.recargo) + '</b>', true) + td('<b>' + money(totales.pagado) + '</b>', true) +
          td('<b>' + money(totales.saldo) + '</b>', true) + td('') + '</tr></table>' +
        '<div style="margin-top:16px;padding:10px 12px;border:1.5px solid #333;border-radius:4px;font-size:11.5pt;">' +
          (deuda.monto > 0
            ? 'Deuda vencida al ' + esc(fmtDate(hoy)) + ': <b>' + money(deuda.monto) + '</b> (' + plural(deuda.meses, 'cuota', 'cuotas') + ', desde ' + esc(fmtPeriodo(deuda.primerPeriodo)) + ')' +
              (deuda.recargos ? ', de los cuales ' + money(deuda.recargos) + ' son recargos por mora.' : '.')
            : 'El inquilino no tiene cuotas vencidas pendientes al ' + esc(fmtDate(hoy)) + '.') +
        '</div>' +
        (pagos.length ? '<div style="font-weight:bold;margin:18px 0 4px;">Pagos recibidos</div><table style="width:100%;border-collapse:collapse;"><tr>' +
          th('Fecha') + th('Recibo') + th('Mes que paga') + th('Método') + th('Monto', true) + '</tr>' +
          pagos.map(pg => '<tr>' + td(esc(fmtDate(pg.fecha))) + td('No. ' + esc(String(pg.numero || '').padStart(5, '0'))) + td(esc(fmtPeriodo(pg.periodo))) +
            td(esc((pg.metodo || '') + (pg.referencia ? ' · ' + pg.referencia : ''))) + td(money(pg.monto), true) + '</tr>').join('') + '</table>' : '') +
      '</div>';
    const t = inquilinosDe(c)[0] || { nombre:'inquilino' };
    const title = 'Estado_de_cuenta_' + t.nombre.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_') + '_' + hoy;
    await printHtml(bodyHtml, title);
  }

  // Saca un documento según Configuración: lo abre en el navegador para
  // imprimir (como el redactor) o lo guarda directamente como PDF.
  // "comoPdf" fuerza el PDF (botones "Guardar PDF").
  async function printHtml(bodyHtml, title, comoPdf){
    if (window.rcPrint && window.rcPrint.pdf && (comoPdf || ajuste('salida') === 'pdf')) {
      const r = await window.rcPrint.pdf({ bodyHtml, pageSize: ajuste('papel'), landscape:false, title });
      if (r && r.ok) {
        if (await ui.showConfirmDialog('PDF guardado: ' + r.name + '. ¿Abrirlo ahora?', 'PDF guardado')) window.rcPrint.openLastPdf();
      } else if (r && !r.canceled) {
        await ui.showNotice('No se pudo guardar el PDF' + (r.error ? ': ' + r.error : '.'));
      }
      return;
    }
    if (window.rcPrint && window.rcPrint.print) {
      const result = await window.rcPrint.print({ bodyHtml, pageSize: ajuste('papel'), landscape:false, title });
      if (!result || !result.success) await ui.showNotice('No se pudo abrir el documento en el navegador' + (result && result.error ? ': ' + result.error : '.'));
      return;
    }
    const win = window.open('', '_blank');
    if (!win) { await ui.showNotice('El navegador bloqueó la ventana del documento.'); return; }
    win.document.write('<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><title>' + esc(title) + '</title></head><body style="font-family:Georgia,serif;padding:24px;">' + bodyHtml + '</body></html>');
    win.document.close();
  }

  // ---------- Recordatorio de pago (WhatsApp / correo) ----------
  const reminderOverlay = $('reminderOverlay');
  const reminderText = $('reminderText');
  let reminderContract = null;

  // Para WhatsApp hace falta el número con código de país; los de
  // República Dominicana (809/829/849, 10 dígitos) llevan el 1 delante.
  function whatsappNumber(tel){
    const digits = String(tel || '').replace(/\D+/g, '');
    if (!digits) return '';
    if (digits.length === 10 && /^8[024]9/.test(digits)) return '1' + digits;
    return digits;
  }

  function textoRecordatorio(c){
    const t = inquilinosDe(c)[0] || {};
    const d = deudaDe(c);
    const u = byId(db.unidades, c.unidadId);
    const meses = d.cuotas.map(q => fmtPeriodo(q.p));
    return 'Estimado/a ' + (t.nombre || '') + ':\n\n' +
      'Le recordamos que tiene un saldo pendiente de ' + fmtMoney(d.monto, c.moneda) + ' por el alquiler de ' + unidadLabel(u) +
      (meses.length ? ', correspondiente a ' + (meses.length > 1 ? meses.slice(0, -1).join(', ') + ' y ' + meses[meses.length - 1] : meses[0]) : '') + '.' +
      (d.recargos ? ' Este monto incluye ' + fmtMoney(d.recargos, c.moneda) + ' de recargos por mora.' : '') + '\n\n' +
      'Le agradecemos regularizar su pago a la mayor brevedad. Si ya realizó el pago, por favor envíenos el comprobante.\n\n' +
      'Atentamente,\n' + ajuste('firma') + (ajuste('despachoTelefono') ? '\nTel. ' + ajuste('despachoTelefono') : '');
  }

  // Asunto y nota de seguimiento del mensaje abierto (recordatorio, aviso...).
  let reminderAsunto = 'Recordatorio de pago de alquiler';
  let reminderNota = 'Recordatorio de pago';

  // Abre la ventana de mensaje con otro texto (p. ej. el aviso de aumento).
  function abrirMensaje(c, asunto, texto, titulo, sub){
    reminderContract = c;
    reminderAsunto = asunto;
    reminderNota = titulo;
    const t = inquilinosDe(c)[0] || {};
    $('reminderTitulo').textContent = titulo;
    $('reminderSub').textContent = sub;
    reminderText.value = texto;
    const wa = whatsappNumber(t.telefono);
    $('reminderContacts').innerHTML = 'WhatsApp: ' + (wa ? '<b>+' + esc(wa) + '</b>' : '<span class="muted">sin teléfono registrado</span>') +
      ' · Correo: ' + (t.email ? '<b>' + esc(t.email) + '</b>' : '<span class="muted">sin correo registrado</span>');
    $('reminderWhatsApp').disabled = !wa;
    $('reminderEmail').disabled = !t.email;
    reminderOverlay.classList.add('show');
    reminderText.focus();
  }

  function openRecordatorio(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    reminderContract = c;
    reminderAsunto = 'Recordatorio de pago de alquiler';
    reminderNota = 'Recordatorio de pago';
    $('reminderTitulo').textContent = 'Recordatorio de pago';
    const t = inquilinosDe(c)[0] || {};
    const d = deudaDe(c);
    reminderText.value = textoRecordatorio(c);
    const wa = whatsappNumber(t.telefono);
    $('reminderSub').textContent = (t.nombre || '') + ' · debe ' + fmtMoney(d.monto, c.moneda) + ' (' + plural(d.meses, 'cuota', 'cuotas') + ')';
    $('reminderContacts').innerHTML = 'WhatsApp: ' + (wa ? '<b>+' + esc(wa) + '</b>' : '<span class="muted">sin teléfono registrado</span>') +
      ' · Correo: ' + (t.email ? '<b>' + esc(t.email) + '</b>' : '<span class="muted">sin correo registrado</span>');
    $('reminderWhatsApp').disabled = !wa;
    $('reminderEmail').disabled = !t.email;
    reminderOverlay.classList.add('show');
    reminderText.focus();
  }

  $('reminderClose').addEventListener('click', () => { reminderOverlay.classList.remove('show'); reminderContract = null; });
  $('reminderCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(reminderText.value);
      $('reminderCopy').textContent = 'Copiado ✓';
      setTimeout(() => { $('reminderCopy').textContent = 'Copiar'; }, 1500);
    } catch (err) {
      reminderText.select();
    }
  });
  $('reminderWhatsApp').addEventListener('click', () => {
    if (!reminderContract) return;
    const t = inquilinosDe(reminderContract)[0] || {};
    window.open('https://wa.me/' + whatsappNumber(t.telefono) + '?text=' + encodeURIComponent(reminderText.value), '_blank');
    registrarSeguimiento(t.id, reminderNota + ' enviado por WhatsApp.');
  });
  $('reminderEmail').addEventListener('click', () => {
    if (!reminderContract) return;
    const t = inquilinosDe(reminderContract)[0] || {};
    window.open('mailto:' + encodeURIComponent(t.email) + '?subject=' + encodeURIComponent(reminderAsunto) + '&body=' + encodeURIComponent(reminderText.value), '_blank');
    registrarSeguimiento(t.id, reminderNota + ' enviado por correo.');
  });

  // ---------- Documento del contrato (redactor) ----------
  let linkedContractId = null;
  const linkBar = $('contractLinkBar');
  const linkText = $('contractLinkText');

  function contractTitle(c){
    const t = byId(db.inquilinos, c.inquilinoId);
    return (t ? t.nombre : 'Inquilino') + ' — ' + unidadLabel(byId(db.unidades, c.unidadId));
  }

  function updateLinkBar(){
    const c = linkedContractId ? byId(db.contratos, linkedContractId) : null;
    if (!c) linkedContractId = null;
    linkBar.hidden = !c;
    if (c) linkText.innerHTML = 'Documento del contrato: <strong>' + esc(contractTitle(c)) + '</strong>' + (c.documentoActualizado ? ' · guardado el ' + esc(new Date(c.documentoActualizado).toLocaleString()) : ' · aún no guardado en el contrato');
  }

  function linkContract(c){
    linkedContractId = c.id;
    const t = byId(db.inquilinos, c.inquilinoId);
    const u = byId(db.unidades, c.unidadId);
    const base = ['contrato', t && t.nombre, u && u.identificador].filter(Boolean).join('_');
    ed.setBaseName(base.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9_\-]+/g, '_'));
    updateLinkBar();
  }

  async function confirmReplaceEditor(c){
    if (!ed.hasContent() || linkedContractId === c.id) return true;
    return ui.showConfirmDialog('Esto reemplazará el documento que tienes abierto en el redactor. Si tiene cambios que quieras conservar, guárdalo antes. ¿Continuar?', 'Abrir documento del contrato');
  }

  // ---------- PDF del contrato y contrato firmado ----------
  // Ambos van al expediente del inquilino principal (<carpeta de trabajo>/
  // Expedientes/...), así se ven también en "Archivos del expediente":
  //  - "Contrato - <inmueble> - <inicio>.pdf": se genera al guardar el
  //    documento en el contrato (es el que se imprime para firmar).
  //  - "... (firmado).pdf" (o .jpg...): el escaneado ya firmado, que se sube.
  // c.pdfArchivo y c.firmado = { archivo, fecha } guardan sus nombres.
  function baseArchivoContrato(c){
    const u = byId(db.unidades, c.unidadId);
    return ('Contrato - ' + unidadLabel(u) + (c.fechaInicio ? ' - ' + c.fechaInicio : '')).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 100);
  }

  // PDF del documento abierto en el redactor (el de "c") en su expediente.
  async function guardarPdfContrato(c, silencioso){
    const t = byId(db.inquilinos, c.inquilinoId);
    if (!t || !window.rcExpediente || !ed.datosPdf) return false;
    if (silencioso && !(ed.hasWorkFolder && ed.hasWorkFolder())) return false;
    if (!(await asegurarCarpetaExpediente(t))) return false;
    const r = await window.rcExpediente.pdf(t.expedienteCarpeta, baseArchivoContrato(c) + '.pdf', ed.datosPdf());
    if (!r.ok) {
      if (!silencioso) await ui.showNotice('No se pudo guardar el PDF del contrato: ' + r.error);
      return false;
    }
    c.pdfArchivo = r.name;
    await persist();
    return r.name;
  }

  async function abrirArchivoContrato(c, nombre){
    const t = byId(db.inquilinos, c.inquilinoId);
    const r = t && t.expedienteCarpeta && nombre ? await window.rcExpediente.open(t.expedienteCarpeta, nombre) : { ok:false };
    if (!r.ok) await ui.showNotice('No se encontró "' + (nombre || 'el archivo') + '" en el expediente de ' + (t ? t.nombre : 'el inquilino') + '. Puede que se haya movido o borrado.', 'Archivo no encontrado');
    return r.ok;
  }

  // "Contrato en PDF": lo abre; si todavía no existe (contratos anteriores),
  // lo genera con el documento guardado en el contrato.
  async function contratoPdf(id){
    const c = byId(db.contratos, id);
    if (!c || !c.documentoHtml || !window.rcExpediente) return;
    const t = byId(db.inquilinos, c.inquilinoId);
    if (c.pdfArchivo && t && t.expedienteCarpeta && (await window.rcExpediente.open(t.expedienteCarpeta, c.pdfArchivo)).ok) return;
    if (linkedContractId !== c.id) {
      if (!(await confirmReplaceEditor(c))) return;
      ed.loadHtml(c.documentoHtml);
      linkContract(c);
    }
    const nombre = await guardarPdfContrato(c, false);
    if (nombre) await abrirArchivoContrato(c, nombre);
    renderActive();
    if (tenantDetailId) renderTenantDetail();
  }

  async function subirFirmado(id){
    const c = byId(db.contratos, id);
    const t = c && byId(db.inquilinos, c.inquilinoId);
    if (!c || !t || !window.rcExpediente) return;
    if (!(await asegurarCarpetaExpediente(t))) return;
    if (c.firmado && !(await ui.showConfirmDialog('Este contrato ya tiene su versión firmada ("' + c.firmado.archivo + '"). ¿Reemplazarla?', 'Contrato firmado'))) return;
    const r = await window.rcExpediente.subir(t.expedienteCarpeta, baseArchivoContrato(c) + ' (firmado)', 'Contrato firmado escaneado');
    if (r.canceled) return;
    if (!r.ok) { await ui.showNotice('No se pudo subir el archivo: ' + r.error); return; }
    c.firmado = { archivo: r.name, fecha: new Date().toISOString() };
    await registrarSeguimiento(t.id, 'Contrato firmado subido: ' + r.name + '.'); // también guarda
    renderActive();
    if (tenantDetailId) renderTenantDetail();
  }

  async function openContractDocument(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    closeTenantDetail();
    if (c.documentoHtml) {
      if (linkedContractId !== c.id) {
        if (!(await confirmReplaceEditor(c))) return;
        ed.loadHtml(c.documentoHtml);
        ed.setStatus('Documento del contrato de ' + contractTitle(c) + ' abierto.');
      }
      linkContract(c);
      showView('redactor');
      return;
    }
    openTemplatePicker(c);
  }

  const pickerOverlay = $('templatePickerOverlay');
  const pickerList = $('templatePickerList');
  let pickerContract = null;
  let pickerCaso = null;   // si se redacta un acto de un caso

  async function openTemplatePicker(c, caso){
    pickerContract = c;
    pickerCaso = caso || null;
    const templates = await ed.listTemplates();
    let html = '';
    if (templates.length) {
      html += '<div class="pick-group-label">Modelos de la carpeta</div>' + templates.map(tpl =>
        '<button type="button" class="pick-item" data-pick="tpl" data-id="' + esc(tpl.id) + '">' + esc(tpl.name) + '<span class="pick-sub">Modificado el ' + esc(new Date(tpl.mtime).toLocaleDateString()) + '</span></button>').join('');
    } else if (!ed.hasWorkFolder()) {
      html += '<div class="no-fields">Los modelos se guardan en la carpeta de trabajo del Redactor, y todavía no hay una elegida. Elígela en el Redactor para usar tus modelos.</div>';
    } else {
      html += '<div class="no-fields">Todavía no tienes modelos. En el Redactor, carga el texto de un contrato, inserta campos como "Nombre del inquilino" y pulsa "Guardar como modelo".</div>';
    }
    html += '<div class="pick-group-label">Otras opciones</div>';
    if (ed.hasContent()) html += '<button type="button" class="pick-item" data-pick="current">Usar el documento abierto en el redactor<span class="pick-sub">Se rellenan sus campos con los datos de este contrato.</span></button>';
    html += '<button type="button" class="pick-item" data-pick="blank">Documento en blanco<span class="pick-sub">Escribe o pega el texto desde cero.</span></button>';
    pickerList.innerHTML = html;
    $('templatePickerSub').textContent = (caso ? 'Acto del caso de ' : 'Contrato de ') + contractTitle(c) + '. Los campos con nombres reconocidos se rellenan solos' +
      (caso ? ', también la deuda, el tribunal y el expediente.' : '.');
    pickerOverlay.classList.add('show');
  }

  pickerList.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-pick]');
    if (!btn || !pickerContract) return;
    const c = pickerContract;
    const caso = pickerCaso;
    pickerOverlay.classList.remove('show');
    pickerContract = null;
    pickerCaso = null;
    const kind = btn.dataset.pick;
    if (kind === 'tpl') {
      if (!(await confirmReplaceEditor(c))) return;
      try {
        ed.loadHtml(await ed.readTemplate(btn.dataset.id));
      } catch (err) {
        await ui.showNotice('No se pudo abrir el modelo: ' + err.message, 'Error');
        return;
      }
    } else if (kind === 'blank') {
      if (!(await confirmReplaceEditor(c))) return;
      ed.loadHtml('<p><br></p>');
    }
    if (caso) {
      // Un acto no es el documento del contrato: se guarda como .doc aparte.
      linkedContractId = null;
      updateLinkBar();
      const t = byId(db.inquilinos, c.inquilinoId);
      ed.setBaseName(('acto_' + (t ? t.nombre : 'caso') + '_' + todayStr()).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_\-]+/g, '_'));
      anotarCaso(caso, 'Acto redactado' + (kind === 'tpl' ? ' con el modelo "' + btn.firstChild.textContent.trim() + '"' : '') + '.');
      persist();
      closeCaso();
    } else {
      linkContract(c);
    }
    const filled = fillEditorFromContract(c, caso);
    ed.setStatus(filled ? 'Se rellenaron ' + plural(filled, 'campo', 'campos') + ' con los datos del ' + (caso ? 'caso' : 'contrato') + '.' : 'Documento listo. Inserta campos con los nombres de la lista para rellenarlos con los datos del contrato.');
    showView('redactor');
  });
  $('templatePickerCancel').addEventListener('click', () => { pickerOverlay.classList.remove('show'); pickerContract = null; pickerCaso = null; });

  $('btnLinkFill').addEventListener('click', async () => {
    const c = byId(db.contratos, linkedContractId);
    if (!c) return;
    const filled = fillEditorFromContract(c);
    await ui.showNotice(filled
      ? 'Se rellenaron ' + plural(filled, 'campo', 'campos') + ' con los datos actuales del contrato.'
      : 'No hay campos con nombres reconocidos. Inserta un campo y elige su nombre de la lista (p. ej. "Nombre del inquilino").', 'Rellenar datos');
  });

  $('btnLinkSave').addEventListener('click', async () => {
    const c = byId(db.contratos, linkedContractId);
    if (!c) return;
    if (!ed.hasContent()) { await ui.showNotice('El documento está vacío.'); return; }
    c.documentoHtml = ed.getHtml();
    c.documentoActualizado = new Date().toISOString();
    if (await persist()) {
      ed.setStatus('Documento guardado en el contrato de ' + contractTitle(c) + '.');
      updateLinkBar();
      // Y su PDF en el expediente, listo para imprimir y firmar.
      if (await guardarPdfContrato(c, true)) ed.setStatus('Documento guardado en el contrato de ' + contractTitle(c) + ' y su PDF en el expediente.');
    }
  });

  $('btnLinkClose').addEventListener('click', () => {
    linkedContractId = null;
    updateLinkBar();
    ed.setStatus('El documento ya no está asociado a ningún contrato.');
  });

  // ---------------------------------------------------------------
  // Finanzas: cobros (cuotas mensuales y pagos), gastos y balance.
  //
  // Cada contrato genera una cuota por mes ("periodo" 'AAAA-MM') desde el
  // mes de inicio hasta el de fin (o hasta el mes en que se finalizó),
  // que vence el "día de pago" de ese mes. Un pago se registra contra un
  // contrato y un periodo; puede haber varios pagos (abonos) por periodo.
  // Los montos se agrupan siempre por moneda: nunca se suman RD$ con US$.
  // ---------------------------------------------------------------
  const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const METODOS_PAGO = ['Transferencia', 'Efectivo', 'Depósito', 'Cheque', 'Tarjeta', 'Otro'];
  const CATEGORIAS_GASTO = ['Reparación', 'Mantenimiento', 'Electricidad', 'Agua', 'Internet / cable', 'Gas', 'Limpieza',
    'Seguridad', 'Jardinería', 'Impuestos', 'Seguros', 'Administración', 'Otros'];

  function round2(n){ return Math.round(n * 100) / 100; }
  function monthOf(s){ return s ? String(s).slice(0, 7) : ''; }
  function addMonthsP(p, n){
    const [y, m] = p.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
  }
  function fmtPeriodo(p){
    if (!p) return '—';
    const [y, m] = p.split('-').map(Number);
    return MESES[m - 1] + ' ' + y;
  }

  // Último mes en que el contrato genera cuota.
  function lastPeriodOf(c){
    let end = monthOf(c.fechaFin);
    if (!isActive(c) && c.fechaFinalizacion && monthOf(c.fechaFinalizacion) < end) end = monthOf(c.fechaFinalizacion);
    return end;
  }
  function contractCoversPeriod(c, p){
    if (!c.fechaInicio || !c.fechaFin) return false;
    return p >= monthOf(c.fechaInicio) && p <= lastPeriodOf(c);
  }
  function periodsUntil(c, limit){
    const out = [];
    if (!c.fechaInicio || !c.fechaFin) return out;
    const end = lastPeriodOf(c) < limit ? lastPeriodOf(c) : limit;
    for (let p = monthOf(c.fechaInicio); p <= end && out.length < 600; p = addMonthsP(p, 1)) out.push(p);
    return out;
  }
  function dueDateOf(c, p){
    const [y, m] = p.split('-').map(Number);
    const lastDay = new Date(y, m, 0).getDate();
    const day = Math.min(Math.max(Number(c.diaPago) || 1, 1), lastDay);
    return p + '-' + String(day).padStart(2, '0');
  }
  function paidFor(contratoId, p){
    return round2(db.pagos.filter(pg => pg.contratoId === contratoId && pg.periodo === p).reduce((s, pg) => s + (Number(pg.monto) || 0), 0));
  }

  // Recargo por mora de un contrato: un cargo único por cuota (no se
  // acumula) cuando, pasados los días de gracia desde el vencimiento, lo
  // pagado hasta ese día no cubría la cuota. Se puede condonar por mes.
  function hasMora(c){ return c.moraTipo && c.moraTipo !== 'ninguna' && Number(c.moraValor) > 0; }
  function moraLabel(c){
    if (!hasMora(c)) return 'Sin recargo por mora';
    return (c.moraTipo === 'porcentaje' ? fmtNumber(c.moraValor).replace(/[.,]00$/, '') + '% de la cuota' : fmtMoney(c.moraValor, c.moneda)) +
      ' tras ' + plural(Number(c.moraGracia) || 0, 'día', 'días') + ' de gracia';
  }
  function limiteMora(c, vence){ return addDays(vence, Number(c.moraGracia) || 0); }
  function recargoDe(c, p, monto, vence){
    if (!hasMora(c) || (c.recargosCondonados || []).includes(p)) return 0;
    const limite = limiteMora(c, vence);
    if (todayStr() <= limite) return 0;
    const aTiempo = db.pagos.filter(pg => pg.contratoId === c.id && pg.periodo === p && pg.fecha && pg.fecha <= limite)
      .reduce((s, pg) => s + (Number(pg.monto) || 0), 0);
    if (aTiempo >= monto - 0.005) return 0;
    return round2(c.moraTipo === 'porcentaje' ? monto * Number(c.moraValor) / 100 : Number(c.moraValor));
  }

  // Alquiler vigente en un mes. Con aumentos aplicados, c.montos guarda el
  // historial [{ desde:'AAAA-MM', monto }] y c.monto es el actual.
  function montoEn(c, p){
    const h = c.montos;
    if (!h || !h.length) return Number(c.monto) || 0;
    let m = h[0].monto;
    h.forEach(x => { if (x.desde <= p) m = x.monto; });
    return Number(m) || 0;
  }
  function itbisDe(c, alquiler){ return Number(c.itbis) > 0 ? round2(alquiler * Number(c.itbis) / 100) : 0; }

  // Estado de la cuota de un contrato en un mes. "monto" es la cuota del
  // contrato (alquiler del mes más el ITBIS, si el contrato lo lleva);
  // "total" incluye el recargo por mora si corresponde.
  function cuota(c, p){
    const alquiler = montoEn(c, p);
    const itbis = itbisDe(c, alquiler);
    const monto = round2(alquiler + itbis);
    const pagado = paidFor(c.id, p);
    const vence = dueDateOf(c, p);
    const recargo = recargoDe(c, p, monto, vence);
    const total = round2(monto + recargo);
    const saldo = Math.max(0, round2(total - pagado));
    const vencida = vence < todayStr();
    let key, label;
    if (saldo <= 0) { key = 'pagado'; label = 'Pagado'; }
    else if (vencida) { key = pagado > 0 ? 'parcial-atrasado' : 'atrasado'; label = pagado > 0 ? 'Parcial · atrasado' : 'Atrasado'; }
    else if (pagado > 0) { key = 'parcial'; label = 'Parcial'; }
    else { key = 'pendiente'; label = 'Pendiente'; }
    return { c, p, alquiler, itbis, monto, recargo, total, pagado, saldo, vence, key, label };
  }
  const CUOTA_ORDEN = { 'atrasado':0, 'parcial-atrasado':1, 'pendiente':2, 'parcial':3, 'pagado':4 };

  // Deuda vencida de un contrato: saldo de las cuotas cuya fecha de pago
  // ya pasó, con el detalle de cada una (para el estado de cuenta, la
  // aplicación del depósito y la morosidad por antigüedad).
  function deudaDe(c){
    const hoy = todayStr();
    let monto = 0, recargos = 0, primerPeriodo = null;
    const cuotas = [];
    periodsUntil(c, monthOf(hoy)).forEach(p => {
      const q = cuota(c, p);
      if (q.saldo > 0 && q.vence < hoy) {
        monto += q.saldo;
        recargos += q.recargo;
        cuotas.push(q);
        if (!primerPeriodo) primerPeriodo = p;
      }
    });
    return { monto: round2(monto), recargos: round2(recargos), meses: cuotas.length, primerPeriodo, cuotas };
  }

  function sumByMoneda(items, getMonto, getMoneda){
    const out = {};
    items.forEach(x => {
      const n = Number(getMonto(x));
      if (!n || isNaN(n)) return;
      const m = getMoneda(x) || '';
      out[m] = round2((out[m] || 0) + n);
    });
    return out;
  }
  function moneyLines(totals){
    const keys = Object.keys(totals);
    return keys.length ? keys.map(m => esc(fmtMoney(totals[m], m))).join('<br>') : '—';
  }

  function edificioIdDeContrato(c){
    const u = byId(db.unidades, c.unidadId);
    return u ? u.edificioId : null;
  }

  function fillBuildingSelect(select, allLabel){
    const value = select.value;
    select.innerHTML = '<option value="">' + esc(allLabel) + '</option>' +
      db.edificios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre))
        .map(b => '<option value="' + esc(b.id) + '">' + esc(b.nombre) + '</option>').join('');
    select.value = byId(db.edificios, value) ? value : '';
  }

  function comparePagos(a, b){
    return (b.fecha || '').localeCompare(a.fecha || '') || (Number(b.numero) || 0) - (Number(a.numero) || 0);
  }

  // Un pago que cubre varios meses se guarda como una parte por mes, todas
  // con el mismo "grupo" y el mismo número de recibo. Así cada cuota sabe
  // cuánto se le pagó, y el pago se muestra, imprime y elimina completo.
  function partesDePago(pg){
    return pg.grupo ? db.pagos.filter(x => x.grupo === pg.grupo).sort((a, b) => (a.periodo || '').localeCompare(b.periodo || '')) : [pg];
  }
  function agruparPagos(list){
    const vistos = new Set();
    const grupos = [];
    list.forEach(pg => {
      const key = pg.grupo || pg.id;
      if (vistos.has(key)) return;
      vistos.add(key);
      const partes = partesDePago(pg);
      grupos.push({ pg: partes[0], partes, total: round2(partes.reduce((s, x) => s + (Number(x.monto) || 0), 0)) });
    });
    return grupos;
  }
  function retenidoDe(partes){ return round2(partes.reduce((s, x) => s + (Number(x.retencion) || 0), 0)); }
  function listaMeses(partes){
    const meses = partes.map(x => fmtPeriodo(x.periodo));
    return meses.length > 1 ? meses.slice(0, -1).join(', ') + ' y ' + meses[meses.length - 1] : meses[0];
  }

  function pagosTable(list, showTenant){
    return '<table class="data-table"><thead><tr><th>Recibo</th><th>Fecha</th>' + (showTenant ? '<th>Inquilino</th>' : '') +
      '<th>Mes que paga</th><th>Método</th><th class="num">Monto</th><th></th></tr></thead><tbody>' +
      agruparPagos(list).map(({ pg, partes, total }) => {
        const c = byId(db.contratos, pg.contratoId);
        const t = c ? byId(db.inquilinos, c.inquilinoId) : null;
        const meses = partes.length > 1
          ? esc(fmtPeriodo(partes[0].periodo)) + ' – ' + esc(fmtPeriodo(partes[partes.length - 1].periodo)) +
            '<span class="cell-sub" title="' + esc(partes.map(x => fmtPeriodo(x.periodo) + ': ' + fmtMoney(x.monto, x.moneda)).join('\n')) + '">' + plural(partes.length, 'mes', 'meses') + '</span>'
          : esc(fmtPeriodo(pg.periodo));
        return '<tr><td class="muted">No. ' + esc(String(pg.numero || '').padStart(5, '0')) + '</td>' +
          '<td>' + esc(fmtDate(pg.fecha)) + '</td>' +
          (showTenant ? '<td>' + (t ? '<button type="button" class="link-btn" data-act="ver-inquilino" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button>' : '<span class="muted">—</span>') +
            '<span class="cell-sub">' + esc(c ? unidadLabel(byId(db.unidades, c.unidadId)) : '(contrato eliminado)') + '</span></td>' : '') +
          '<td>' + meses + '</td>' +
          '<td>' + esc(pg.metodo || '—') + (pg.referencia ? '<span class="cell-sub">Ref. ' + esc(pg.referencia) + '</span>' : '') + '</td>' +
          '<td class="num">' + esc(fmtMoney(total, pg.moneda)) + (retenidoDe(partes) ? '<span class="cell-sub">ISR retenido ' + esc(fmtMoney(retenidoDe(partes), pg.moneda)) + '</span>' : '') + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn-panel" data-act="recibo" data-id="' + esc(pg.id) + '">Recibo</button>' +
            '<button type="button" class="btn-panel" data-act="editar-pago" data-id="' + esc(pg.id) + '">Editar</button>' +
            '<button type="button" class="btn-wine" data-act="borrar-pago" data-id="' + esc(pg.id) + '">Eliminar</button>' +
            rowMenu([{ act:'recibo-pdf', id:pg.id, label:'Guardar recibo en PDF' }]) +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---------- Cobros ----------
  const cobrosMes = $('cobrosMes');
  const cobrosEdificio = $('cobrosEdificio');
  cobrosMes.value = monthOf(todayStr());
  cobrosMes.addEventListener('input', () => { if (cobrosMes.value) renderCobros(); });
  cobrosEdificio.addEventListener('input', renderCobros);
  $('cobrosPrev').addEventListener('click', () => { cobrosMes.value = addMonthsP(cobrosMes.value || monthOf(todayStr()), -1); renderCobros(); });
  $('cobrosNext').addEventListener('click', () => { cobrosMes.value = addMonthsP(cobrosMes.value || monthOf(todayStr()), 1); renderCobros(); });

  function renderCobros(){
    fillBuildingSelect(cobrosEdificio, 'Todos los edificios');
    const p = cobrosMes.value || monthOf(todayStr());
    const edf = cobrosEdificio.value;
    const enEdificio = (c) => !edf || edificioIdDeContrato(c) === edf;
    const cuotas = db.contratos.filter(c => enEdificio(c) && contractCoversPeriod(c, p)).map(c => cuota(c, p))
      .sort((a, b) => CUOTA_ORDEN[a.key] - CUOTA_ORDEN[b.key] || a.vence.localeCompare(b.vence));
    const deudas = db.contratos.filter(enEdificio).map(c => ({ c, d: deudaDe(c) })).filter(x => x.d.monto > 0);
    const atrasadas = cuotas.filter(q => q.key === 'atrasado' || q.key === 'parcial-atrasado').length;
    const moneda = q => q.c.moneda;

    $('cobrosStats').innerHTML = [
      stat('Esperado en ' + MESES[Number(p.slice(5)) - 1], moneyLines(sumByMoneda(cuotas, q => q.total, moneda)), plural(cuotas.length, 'cuota', 'cuotas'), true),
      stat('Cobrado', moneyLines(sumByMoneda(cuotas, q => q.pagado, moneda)), plural(cuotas.filter(q => q.key === 'pagado').length, 'cuota pagada', 'cuotas pagadas') + ' por completo', true),
      stat('Por cobrar', moneyLines(sumByMoneda(cuotas, q => q.saldo, moneda)), atrasadas ? plural(atrasadas, 'cuota atrasada', 'cuotas atrasadas') : 'Ninguna atrasada', true),
      stat('Deuda acumulada', moneyLines(sumByMoneda(deudas, x => x.d.monto, x => x.c.moneda)), deudas.length ? plural(deudas.length, 'contrato debe', 'contratos deben') + ' meses vencidos' : 'Todos al día', true)
    ].join('');

    $('cobrosCuotasTitulo').textContent = 'Cuotas de ' + fmtPeriodo(p);
    const deudaPorContrato = new Map(deudas.map(x => [x.c.id, x.d]));
    $('cobrosCuotas').innerHTML = cuotas.length
      ? '<table class="data-table"><thead><tr><th>Inquilino</th><th class="num">Cuota</th><th class="num">Pagado</th><th class="num">Saldo</th><th>Vence</th><th>Estado</th><th class="num">Deuda total</th><th></th></tr></thead><tbody>' +
        cuotas.map(q => {
          const t = byId(db.inquilinos, q.c.inquilinoId);
          const d = deudaPorContrato.get(q.c.id);
          return '<tr><td>' + (t ? '<button type="button" class="link-btn" data-act="ver-inquilino" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button>' : '<span class="muted">(inquilino eliminado)</span>') +
              '<span class="cell-sub">' + esc(unidadLabel(byId(db.unidades, q.c.unidadId))) + '</span></td>' +
            '<td class="num">' + esc(fmtMoney(q.total, q.c.moneda)) + (q.itbis ? '<span class="cell-sub">incluye ITBIS ' + esc(fmtMoney(q.itbis, q.c.moneda)) + '</span>' : '') + (q.recargo ? '<span class="cell-sub warn-text">incluye recargo ' + esc(fmtMoney(q.recargo, q.c.moneda)) + '</span>' : '') +
              ((q.c.recargosCondonados || []).includes(p) ? '<span class="cell-sub">recargo condonado</span>' : '') + '</td>' +
            '<td class="num">' + (q.pagado ? esc(fmtMoney(q.pagado, q.c.moneda)) : '<span class="muted">—</span>') + '</td>' +
            '<td class="num">' + (q.saldo ? esc(fmtMoney(q.saldo, q.c.moneda)) : '<span class="muted">—</span>') + '</td>' +
            '<td class="nowrap">' + esc(fmtDate(q.vence)) + '</td>' +
            '<td>' + badge(q.key, q.label) + '</td>' +
            '<td class="num">' + (d ? esc(fmtMoney(d.monto, q.c.moneda)) + '<span class="cell-sub">' + plural(d.meses, 'mes', 'meses') + '</span>' : '<span class="muted">Al día</span>') + '</td>' +
            '<td><div class="row-actions">' + (q.saldo > 0
              ? '<button type="button" class="btn-brass" data-act="pagar" data-id="' + esc(q.c.id) + '" data-periodo="' + esc(p) + '">Registrar pago</button>'
              : '') +
              rowMenu([
                d && { act:'recordar', id:q.c.id, label:'Enviar recordatorio de pago' },
                q.recargo > 0 && { act:'condonar-recargo', id:q.c.id, periodo:p, label:'Condonar recargo de este mes' },
                (q.c.recargosCondonados || []).includes(p) && { act:'restituir-recargo', id:q.c.id, periodo:p, label:'Volver a cobrar el recargo' },
                { act:'estado-cuenta-inquilino', id:q.c.id, label:'Estado de cuenta del inquilino' }
              ]) + '</div></td></tr>';
        }).join('') + '</tbody></table>'
      : emptyState('Sin cuotas este mes', db.contratos.length ? 'Ningún contrato cubre ' + fmtPeriodo(p) + (edf ? ' en este edificio' : '') + '.' : 'Cuando registres contratos, aquí verás sus cuotas mensuales.');

    const pagos = db.pagos.filter(pg => pg.periodo === p && (!edf || (byId(db.contratos, pg.contratoId) && enEdificio(byId(db.contratos, pg.contratoId))))).sort(comparePagos);
    $('cobrosPagos').innerHTML = pagos.length ? pagosTable(pagos, true) : emptyState('Sin pagos', 'Todavía no hay pagos registrados para ' + fmtPeriodo(p) + '.');
  }

  function contratoOptionLabel(c){
    const t = byId(db.inquilinos, c.inquilinoId);
    return (t ? t.nombre : '(inquilino eliminado)') + ' — ' + unidadLabel(byId(db.unidades, c.unidadId)) + (isActive(c) ? '' : ' (finalizado)');
  }

  function pagoFields(nuevo){
    const contratos = db.contratos.slice().sort((a, b) => (isActive(b) - isActive(a)) || contratoOptionLabel(a).localeCompare(contratoOptionLabel(b)));
    return [
      { name:'contratoId', label:'Contrato', type:'select', required:true, full:true, options: contratos.map(c => ({ value:c.id, label:contratoOptionLabel(c) })) },
      { name:'periodo', label: nuevo ? 'Mes que paga (o el primero, si son varios)' : 'Mes que paga', type:'month', required:true },
      { name:'fecha', label:'Fecha de pago', type:'date', required:true },
      { name:'monto', label:'Monto recibido', type:'number', required:true, min:0, step:'0.01' },
      { name:'retencion', label:'ISR retenido por el inquilino', type:'number', min:0, step:'0.01' },
      nuevo && { name:'repartir', label:'Si el monto supera la cuota, aplicar el resto a los meses pendientes siguientes', type:'checkbox', full:true },
      { name:'metodo', label:'Método de pago', type:'select', options: METODOS_PAGO.map(m => ({ value:m, label:m })) },
      { name:'referencia', label:'Referencia / No. de transacción', full:true },
      { name:'notas', label:'Notas', type:'textarea', full:true }
    ].filter(Boolean);
  }

  function cuotaHint(contratoId, periodo){
    const c = byId(db.contratos, contratoId);
    if (!c || !periodo) return '';
    if (!contractCoversPeriod(c, periodo)) return 'Atención: el contrato no cubre ' + fmtPeriodo(periodo) + ' (' + fmtDate(c.fechaInicio) + ' – ' + fmtDate(c.fechaFin) + ').';
    const q = cuota(c, periodo);
    const d = deudaDe(c);
    return 'Cuota ' + fmtMoney(q.monto, c.moneda) + (q.itbis ? ' (incluye ITBIS ' + fmtMoney(q.itbis, c.moneda) + ')' : '') + (q.recargo ? ' + recargo ' + fmtMoney(q.recargo, c.moneda) : '') +
      ' · pagado ' + fmtMoney(q.pagado, c.moneda) + ' · saldo ' + fmtMoney(q.saldo, c.moneda) + '.' +
      (d.monto > 0 ? ' Deuda vencida total: ' + fmtMoney(d.monto, c.moneda) + ' (' + plural(d.meses, 'cuota', 'cuotas') + ').' : '') +
      (d.primerPeriodo && d.primerPeriodo < periodo ? ' Ojo: hay cuotas anteriores pendientes desde ' + fmtPeriodo(d.primerPeriodo) + '.' : '');
  }

  // Reparte un monto entre las cuotas con saldo a partir de "desde", en
  // orden. Lo que sobre después de la última cuota del contrato queda en
  // "sobrante".
  function repartoPago(c, desde, monto){
    const partes = [];
    let resto = round2(monto);
    for (const p of periodsUntil(c, lastPeriodOf(c)).filter(per => per >= desde)) {
      if (resto <= 0) break;
      const saldo = cuota(c, p).saldo;
      if (saldo <= 0) continue;
      const parte = round2(Math.min(resto, saldo));
      partes.push({ p, monto: parte });
      resto = round2(resto - parte);
    }
    return { partes, sobrante: resto };
  }

  function textoReparto(c, desde, monto){
    if (!c || !desde || !(monto > 0) || !contractCoversPeriod(c, desde)) return '';
    const r = repartoPago(c, desde, monto);
    if (r.partes.length <= 1 && !r.sobrante) return '';
    return 'Se aplicará a: ' + r.partes.map(x => fmtPeriodo(x.p) + ' ' + fmtMoney(x.monto, c.moneda)).join(' · ') +
      (r.sobrante ? ' · sobran ' + fmtMoney(r.sobrante, c.moneda) + ', que quedan como pago adelantado' : '') + '.';
  }

  // Monto a recibir y retención propuestos para la cuota de un mes: si el
  // contrato tiene retención de ISR, se calcula sobre el alquiler (sin ITBIS)
  // cuando se paga la cuota completa.
  function propuestaPago(c, periodo){
    const q = cuota(c, periodo);
    const pct = Number(c.retencionIsr) || 0;
    const retencion = pct > 0 && q.saldo >= q.monto - 0.005 ? round2(q.alquiler * pct / 100) : 0;
    return { monto: q.saldo ? round2(q.saldo - retencion) : '', retencion: retencion || '' };
  }

  // Siguiente número de recibo (todas las partes de un pago comparten el suyo).
  function siguienteNumeroRecibo(){
    return db.pagos.reduce((max, pg) => Math.max(max, Number(pg.numero) || 0), 0) + 1;
  }

  async function openPagoForm(id, defaults){
    if (!db.contratos.length) {
      await ui.showNotice('Para registrar pagos primero crea el contrato del inquilino.', 'Sin contratos');
      return;
    }
    const current = id ? byId(db.pagos, id) : null;
    if (current && current.grupo) { openPagoGrupoForm(current); return; }
    const values = current ? Object.assign({}, current) : Object.assign({ fecha: todayStr(), periodo: monthOf(todayStr()), metodo: METODOS_PAGO[0], repartir: true }, defaults);
    // En el formulario, "monto" es lo recibido; lo guardado incluye la retención.
    if (current) values.monto = round2((Number(current.monto) || 0) - (Number(current.retencion) || 0));
    if (!current && values.contratoId && values.periodo && values.monto == null) {
      const c = byId(db.contratos, values.contratoId);
      if (c) Object.assign(values, propuestaPago(c, values.periodo));
    }
    const actualizarAyuda = (form) => {
      const get = (n) => form.querySelector('[name="' + n + '"]');
      const c = byId(db.contratos, get('contratoId').value);
      $('pagoHint').textContent = cuotaHint(get('contratoId').value, get('periodo').value);
      const repartir = get('repartir');
      $('pagoReparto').textContent = repartir && repartir.checked ? textoReparto(c, get('periodo').value, Number(get('monto').value) + (Number(get('retencion').value) || 0)) : '';
    };
    openForm({
      title: current ? 'Editar pago' : 'Registrar pago',
      subtitle: current ? 'Recibo No. ' + String(current.numero || '').padStart(5, '0') : 'Si recibes varios meses juntos, escribe el total: se reparte entre las cuotas pendientes en orden y sale un solo recibo.',
      fields: pagoFields(!current),
      values,
      afterRender(form){
        const help = document.createElement('div');
        help.className = 'field-help';
        help.id = 'pagoHint';
        const reparto = document.createElement('div');
        reparto.className = 'field-help reparto-help';
        reparto.id = 'pagoReparto';
        form.querySelector('[name="monto"]').after(help, reparto);
        actualizarAyuda(form);
      },
      onInput(form, name){
        const get = (n) => form.querySelector('[name="' + n + '"]');
        if (name === 'contratoId' || name === 'periodo') {
          const c = byId(db.contratos, get('contratoId').value);
          const periodo = get('periodo').value;
          if (!current && c && periodo && contractCoversPeriod(c, periodo)) {
            const prop = propuestaPago(c, periodo);
            get('monto').value = prop.monto;
            get('retencion').value = prop.retencion;
          }
        }
        actualizarAyuda(form);
      },
      async onSave(values){
        if (!(values.monto > 0)) return 'El monto del pago debe ser mayor que cero.';
        const c = byId(db.contratos, values.contratoId);
        if (!c) return 'Elige el contrato al que corresponde el pago.';
        const cubre = contractCoversPeriod(c, values.periodo);
        if (!cubre) {
          const ok = await ui.showConfirmDialog('El contrato no cubre ' + fmtPeriodo(values.periodo) + ' (va del ' + fmtDate(c.fechaInicio) + ' al ' + fmtDate(c.fechaFin) + '). ¿Registrar el pago de todos modos?', 'Mes fuera del contrato');
          if (!ok) return false;
        }
        const repartir = values.repartir;
        delete values.repartir;
        values.moneda = c.moneda;
        // Lo que se aplica a las cuotas es lo recibido más lo retenido.
        const retencion = round2(Number(values.retencion) || 0);
        values.retencion = retencion || null;
        values.monto = round2(values.monto + retencion);
        if (current) {
          Object.assign(current, values);
          return persist();
        }
        let partes = [{ p: values.periodo, monto: values.monto }];
        if (repartir && cubre) {
          const r = repartoPago(c, values.periodo, values.monto);
          if (r.partes.length) partes = r.partes;
          if (r.sobrante > 0 && r.partes.length) {
            const ultimo = partes[partes.length - 1];
            const ok = await ui.showConfirmDialog('Después de cubrir ' + plural(partes.length, 'cuota', 'cuotas') + ' sobran ' + fmtMoney(r.sobrante, c.moneda) +
              '. Se registrarán como pago adelantado de ' + fmtPeriodo(ultimo.p) + '. ¿Continuar?', 'Pago mayor que la deuda');
            if (!ok) return false;
            ultimo.monto = round2(ultimo.monto + r.sobrante);
          }
        }
        const numero = siguienteNumeroRecibo();
        const grupo = partes.length > 1 ? uid('grp') : null;
        const creado = new Date().toISOString();
        // La retención se reparte entre los meses en proporción a lo aplicado.
        let retenido = 0;
        partes.forEach((x, i) => {
          const ret = !retencion ? null : i === partes.length - 1 ? round2(retencion - retenido) : round2(retencion * x.monto / values.monto);
          retenido = round2(retenido + (ret || 0));
          db.pagos.push(Object.assign({ id: uid('pag'), numero, creado }, values, { periodo: x.p, monto: x.monto, retencion: ret, grupo }));
        });
        return persist();
      }
    });
  }

  // Un pago de varios meses se edita completo: solo sus datos comunes. Para
  // cambiar el monto o los meses, se elimina y se registra de nuevo.
  function openPagoGrupoForm(pg){
    const partes = partesDePago(pg);
    const total = round2(partes.reduce((s, x) => s + (Number(x.monto) || 0), 0));
    openForm({
      title: 'Editar pago',
      subtitle: 'Recibo No. ' + String(pg.numero || '').padStart(5, '0') + ' · ' + fmtMoney(total, pg.moneda) + ' para ' + listaMeses(partes) +
        '. Para cambiar el monto o los meses, elimina el pago y regístralo de nuevo.',
      fields: [
        { name:'fecha', label:'Fecha de pago', type:'date', required:true },
        { name:'metodo', label:'Método de pago', type:'select', options: METODOS_PAGO.map(m => ({ value:m, label:m })) },
        { name:'referencia', label:'Referencia / No. de transacción', full:true },
        { name:'notas', label:'Notas', type:'textarea', full:true }
      ],
      values: pg,
      async onSave(values){
        partes.forEach(x => Object.assign(x, values));
        return persist();
      }
    });
  }

  async function deletePago(id){
    const pg = byId(db.pagos, id);
    if (!pg) return;
    const partes = partesDePago(pg);
    const total = round2(partes.reduce((s, x) => s + (Number(x.monto) || 0), 0));
    const c = byId(db.contratos, pg.contratoId);
    const t = c ? byId(db.inquilinos, c.inquilinoId) : null;
    const ok = await ui.showConfirmDialog('¿Eliminar el pago No. ' + String(pg.numero || '').padStart(5, '0') + ' de ' + fmtMoney(total, pg.moneda) +
      (t ? ' de ' + t.nombre : '') + ' (' + listaMeses(partes) + ')?' + (partes.length > 1 ? ' Cubre ' + plural(partes.length, 'mes', 'meses') + ' y se eliminará completo.' : '') +
      ' Las cuotas volverán a quedar pendientes.', 'Eliminar pago');
    if (!ok) return;
    const ids = new Set(partes.map(x => x.id));
    db.pagos = db.pagos.filter(x => !ids.has(x.id));
    await persist();
    renderActive();
  }

  // Recibo imprimible: se abre en el navegador, igual que la impresión del redactor.
  async function printRecibo(id, comoPdf){
    const pago = byId(db.pagos, id);
    if (!pago) return;
    const partes = partesDePago(pago);
    const pg = Object.assign({}, partes[0], { monto: round2(partes.reduce((s, x) => s + (Number(x.monto) || 0), 0)) });
    const retencionRecibo = round2(partes.reduce((s, x) => s + (Number(x.retencion) || 0), 0));
    const c = byId(db.contratos, pg.contratoId) || {};
    const t = byId(db.inquilinos, c.inquilinoId) || {};
    const u = byId(db.unidades, c.unidadId);
    const b = edificioDe(u) || {};
    const numero = String(pg.numero || '').padStart(5, '0');
    const varios = partes.length > 1;
    const q = c.id && !varios ? cuota(c, pg.periodo) : null;
    const esAbono = q && Number(pg.monto) < q.total;
    // Pago de varios meses: detalle de lo aplicado a cada uno.
    const detalleMeses = varios && c.id
      ? '<table style="width:100%;border-collapse:collapse;margin:4px 0 10px;font-size:10.5pt;"><tr>' +
          '<th style="text-align:left;border-bottom:1px solid #333;padding:4px 0;">Mes</th><th style="text-align:right;border-bottom:1px solid #333;padding:4px 0;">Aplicado</th>' +
          '<th style="text-align:right;border-bottom:1px solid #333;padding:4px 0;">Saldo del mes</th></tr>' +
          partes.map(x => '<tr><td style="padding:3px 0;">' + esc(fmtPeriodo(x.periodo)) + '</td><td style="text-align:right;">' + esc(fmtMoney(x.monto, c.moneda)) + '</td>' +
            '<td style="text-align:right;">' + esc(fmtMoney(cuota(c, x.periodo).saldo, c.moneda)) + '</td></tr>').join('') + '</table>'
      : '';
    const firma = (label, nombre) => '<td style="width:50%;padding:0 18px;text-align:center;vertical-align:bottom;">' +
      '<div style="border-top:1px solid #333;margin-top:56px;padding-top:6px;">' + esc(nombre || '') + '</div><div style="font-size:9.5pt;color:#555;">' + esc(label) + '</div></td>';
    const bodyHtml =
      '<div style="border:1.5px solid #333;border-radius:6px;padding:26px 30px;max-width:680px;margin:0 auto;font-size:11.5pt;">' +
        '<table style="width:100%;border-collapse:collapse;"><tr>' +
          '<td style="vertical-align:top;"><div style="font-size:17pt;font-weight:bold;letter-spacing:.04em;">RECIBO DE PAGO</div>' +
            '<div style="color:#444;">' + esc(b.nombre || '') + (b.direccion ? '<br>' + esc(b.direccion) : '') + '</div>' + lineaDespacho() + '</td>' +
          '<td style="vertical-align:top;text-align:right;"><div style="font-weight:bold;">No. ' + esc(numero) + '</div>' +
            '<div>Fecha: ' + esc(fmtDate(pg.fecha)) + '</div>' +
            '<div style="margin-top:10px;display:inline-block;border:1.5px solid #333;padding:6px 14px;font-size:14pt;font-weight:bold;">' + esc(fmtMoney(pg.monto, pg.moneda)) + '</div></td>' +
        '</tr></table>' +
        '<p style="margin-top:22px;line-height:1.8;">Recibí de <b>' + esc(t.nombre || '—') + '</b>' + (t.documento ? ', documento <b>' + esc(t.documento) + '</b>,' : '') +
          ' la suma de <b>' + esc(fmtMoney(pg.monto, pg.moneda)) + '</b> por concepto de ' + (esAbono ? 'abono al ' : '') + 'alquiler del ' +
          esc(((u && u.tipo) || 'apartamento').toLowerCase()) + ' <b>' + esc(u ? u.identificador : '—') + '</b>' + (b.nombre ? ' de <b>' + esc(b.nombre) + '</b>' : '') +
          ', correspondiente ' + (varios ? 'a los meses de <b>' + esc(listaMeses(partes)) + '</b>' : 'al mes de <b>' + esc(fmtPeriodo(pg.periodo)) + '</b>') + '.</p>' +
        detalleMeses +
        '<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:10.5pt;">' +
          '<tr><td style="padding:3px 0;color:#555;width:38%;">Método de pago</td><td>' + esc(pg.metodo || '—') + '</td></tr>' +
          (retencionRecibo > 0 ? '<tr><td style="padding:3px 0;color:#555;">Recibido</td><td>' + esc(fmtMoney(round2(pg.monto - retencionRecibo), pg.moneda)) + '</td></tr>' +
            '<tr><td style="padding:3px 0;color:#555;">ISR retenido por el inquilino</td><td>' + esc(fmtMoney(retencionRecibo, pg.moneda)) + '</td></tr>' : '') +
          (pg.referencia ? '<tr><td style="padding:3px 0;color:#555;">Referencia</td><td>' + esc(pg.referencia) + '</td></tr>' : '') +
          (q ? '<tr><td style="padding:3px 0;color:#555;">Cuota del mes</td><td>' + esc(fmtMoney(q.monto, c.moneda)) + (q.itbis ? ' (alquiler ' + esc(fmtMoney(q.alquiler, c.moneda)) + ' + ITBIS ' + esc(fmtMoney(q.itbis, c.moneda)) + ')' : '') + '</td></tr>' +
               (q.recargo ? '<tr><td style="padding:3px 0;color:#555;">Recargo por mora</td><td>' + esc(fmtMoney(q.recargo, c.moneda)) + '</td></tr>' : '') +
               '<tr><td style="padding:3px 0;color:#555;">Saldo pendiente del mes</td><td>' + esc(fmtMoney(q.saldo, c.moneda)) + '</td></tr>' : '') +
          (pg.notas ? '<tr><td style="padding:3px 0;color:#555;">Notas</td><td>' + esc(pg.notas) + '</td></tr>' : '') +
        '</table>' +
        '<table style="width:100%;border-collapse:collapse;margin-top:18px;"><tr>' + firma('Recibido por', (propietarioDe(u) || {}).nombre) + firma('Inquilino', t.nombre) + '</tr></table>' +
      '</div>';
    await printHtml(bodyHtml, 'Recibo_' + numero, comoPdf);
  }

  // ---------- Gastos ----------
  const searchGastos = $('searchGastos');
  const gastosEdificio = $('gastosEdificio');
  const gastosCategoria = $('gastosCategoria');
  const gastosMes = $('gastosMes');
  gastosCategoria.innerHTML = '<option value="">Todas las categorías</option>' + CATEGORIAS_GASTO.map(c => '<option value="' + esc(c) + '">' + esc(c) + '</option>').join('');
  [searchGastos, gastosEdificio, gastosCategoria, gastosMes].forEach(el => el.addEventListener('input', renderGastos));

  function gastoLugar(g){
    const b = byId(db.edificios, g.edificioId);
    const u = g.unidadId ? byId(db.unidades, g.unidadId) : null;
    return { edificio: b ? b.nombre : '(edificio eliminado)', lugar: g.unidadId ? (u ? 'Apartamento ' + u.identificador : '(apartamento eliminado)') : 'Áreas comunes' };
  }

  function syncGastosMes(){
    const value = gastosMes.value;
    const meses = [...new Set(db.gastos.map(g => monthOf(g.fecha)).filter(Boolean))].sort().reverse();
    gastosMes.innerHTML = '<option value="">Todos los meses</option>' +
      meses.map(m => '<option value="' + esc(m) + '">' + esc(fmtPeriodo(m)) + '</option>').join('');
    gastosMes.value = meses.includes(value) ? value : '';
  }

  function renderGastos(){
    fillBuildingSelect(gastosEdificio, 'Todos los edificios');
    syncGastosMes();
    const q = normalize(searchGastos.value);
    const edf = gastosEdificio.value;
    const cat = gastosCategoria.value;
    const mes = gastosMes.value;
    const el = $('gastosTabla');
    const list = db.gastos.filter(g => {
      if (edf && g.edificioId !== edf) return false;
      if (cat && g.categoria !== cat) return false;
      if (mes && monthOf(g.fecha) !== mes) return false;
      return !q || normalize([g.descripcion, g.proveedor, g.categoria, g.factura].join(' ')).includes(q);
    }).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || ''));

    const porCategoria = {};
    list.forEach(g => { porCategoria[g.categoria] = (porCategoria[g.categoria] || 0) + 1; });
    const topCat = Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a])[0];
    const comunes = list.filter(g => !g.unidadId);
    $('gastosStats').innerHTML = [
      stat('Total' + (mes ? ' de ' + fmtPeriodo(mes) : ''), moneyLines(sumByMoneda(list, g => g.monto, g => g.moneda)), plural(list.length, 'gasto', 'gastos'), true),
      stat('Áreas comunes', moneyLines(sumByMoneda(comunes, g => g.monto, g => g.moneda)), plural(comunes.length, 'gasto', 'gastos') + ' del edificio en general', true),
      stat('Apartamentos', moneyLines(sumByMoneda(list.filter(g => g.unidadId), g => g.monto, g => g.moneda)), 'Reparaciones y gastos de unidades', true),
      stat('Categoría más frecuente', topCat ? esc(topCat) : '—', topCat ? plural(porCategoria[topCat], 'registro', 'registros') : 'Sin gastos', true)
    ].join('');

    if (!db.gastos.length) {
      el.innerHTML = db.edificios.length
        ? emptyState('Todavía no hay gastos', 'Reparaciones, servicios, limpieza...', '<button type="button" class="btn-brass" data-act="nuevo-gasto">+ Nuevo gasto</button>')
        : emptyState('Primero registra un edificio', 'Cada gasto se asigna a un edificio.', '<button type="button" class="btn-brass" data-act="nuevo-edificio">+ Nuevo edificio</button>');
      return;
    }
    if (!list.length) { el.innerHTML = emptyState('Sin resultados', 'Ningún gasto coincide con los filtros.'); return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Fecha</th><th>Concepto</th><th>Edificio</th><th>Categoría</th><th class="num">Monto</th><th></th></tr></thead><tbody>' +
      list.map(g => {
        const l = gastoLugar(g);
        return '<tr><td class="nowrap">' + esc(fmtDate(g.fecha)) + '</td>' +
          '<td><span class="cell-main">' + esc(g.descripcion) + '</span>' + ((g.proveedor || g.factura) ? '<span class="cell-sub">' + esc([g.proveedor, g.factura ? 'Factura ' + g.factura : ''].filter(Boolean).join(' · ')) + '</span>' : '') + '</td>' +
          '<td>' + esc(l.edificio) + '<span class="cell-sub">' + esc(l.lugar) + '</span></td>' +
          '<td><span class="tag">' + esc(g.categoria || 'Otros') + '</span></td>' +
          '<td class="num">' + esc(fmtMoney(g.monto, g.moneda)) + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn-panel" data-act="duplicar-gasto" data-id="' + esc(g.id) + '" title="Crear un gasto igual con la fecha de hoy (útil para la luz, el internet...)">Repetir</button>' +
            '<button type="button" class="btn-panel" data-act="editar-gasto" data-id="' + esc(g.id) + '">Editar</button>' +
            '<button type="button" class="btn-wine" data-act="borrar-gasto" data-id="' + esc(g.id) + '">Eliminar</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  function unidadOptionsOf(edificioId){
    return [{ value:'', label:'Áreas comunes / todo el edificio' }].concat(
      db.unidades.filter(u => u.edificioId === edificioId).sort((a, b) => compareIds(a.identificador, b.identificador))
        .map(u => ({ value:u.id, label:'Apartamento ' + u.identificador })));
  }

  function gastoFields(edificioId){
    return [
      { name:'edificioId', label:'Edificio', type:'select', required:true,
        options: db.edificios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(b => ({ value:b.id, label:b.nombre })) },
      { name:'unidadId', label:'¿Dónde?', type:'select', options: unidadOptionsOf(edificioId) },
      { name:'categoria', label:'Categoría', type:'select', required:true, options: CATEGORIAS_GASTO.map(c => ({ value:c, label:c })) },
      { name:'fecha', label:'Fecha', type:'date', required:true },
      { name:'descripcion', label:'Concepto', required:true, full:true, placeholder:'Ej: Factura de luz de áreas comunes, reparación de tubería...' },
      { name:'moneda', label:'Moneda', type:'select', options: MONEDAS.map(m => ({ value:m, label:m })) },
      { name:'monto', label:'Monto', type:'number', required:true, min:0, step:'0.01' },
      { name:'proveedor', label:'Proveedor', placeholder:'Empresa o persona' },
      { name:'factura', label:'No. de factura / NCF' },
      { name:'notas', label:'Notas', type:'textarea', full:true }
    ];
  }

  async function openGastoForm(id, defaults){
    if (!db.edificios.length) {
      await ui.showNotice('Primero registra el edificio al que corresponde el gasto.', 'Falta un edificio');
      openEdificioForm();
      return;
    }
    const current = id ? byId(db.gastos, id) : null;
    const values = current ? Object.assign({}, current) : Object.assign({ fecha: todayStr(), moneda: ajuste('moneda'), categoria: CATEGORIAS_GASTO[0] }, defaults);
    if (!values.edificioId && db.edificios.length === 1) values.edificioId = db.edificios[0].id;
    openForm({
      title: current ? 'Editar gasto' : 'Nuevo gasto',
      fields: gastoFields(values.edificioId),
      values,
      onInput(form, name){
        if (name !== 'edificioId') return;
        const select = form.querySelector('[name="unidadId"]');
        select.innerHTML = unidadOptionsOf(form.querySelector('[name="edificioId"]').value)
          .map(o => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('');
      },
      async onSave(values){
        if (!(values.monto > 0)) return 'El monto del gasto debe ser mayor que cero.';
        if (!values.unidadId) values.unidadId = null;
        if (current) Object.assign(current, values);
        else db.gastos.push(Object.assign({ id: uid('gst'), creado: new Date().toISOString() }, values));
        return persist();
      }
    });
  }

  async function deleteGasto(id){
    const g = byId(db.gastos, id);
    if (!g) return;
    if (!(await ui.showConfirmDialog('¿Eliminar el gasto "' + g.descripcion + '" de ' + fmtMoney(g.monto, g.moneda) + ' (' + fmtDate(g.fecha) + ')?', 'Eliminar gasto'))) return;
    db.gastos = db.gastos.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // ---------- Balance ----------
  // Los ingresos se cuentan por la fecha en que se cobró cada pago (no por
  // el mes que paga) y los gastos por su fecha: es el dinero que entró y
  // salió en cada mes.
  const balanceAnio = $('balanceAnio');
  const balanceMoneda = $('balanceMoneda');
  const balanceEdificio = $('balanceEdificio');
  [balanceAnio, balanceMoneda, balanceEdificio].forEach(el => el.addEventListener('input', renderBalance));

  function syncBalanceFilters(){
    const anioActual = String(new Date().getFullYear());
    const anios = new Set([anioActual]);
    db.pagos.forEach(pg => pg.fecha && anios.add(pg.fecha.slice(0, 4)));
    db.gastos.forEach(g => g.fecha && anios.add(g.fecha.slice(0, 4)));
    const prevAnio = balanceAnio.value;
    balanceAnio.innerHTML = [...anios].sort().reverse().map(a => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
    balanceAnio.value = anios.has(prevAnio) ? prevAnio : anioActual;

    // Monedas en uso, la más frecuente primero.
    const uso = {};
    db.contratos.forEach(c => { if (c.moneda) uso[c.moneda] = (uso[c.moneda] || 0) + 1; });
    db.gastos.forEach(g => { if (g.moneda) uso[g.moneda] = (uso[g.moneda] || 0) + 1; });
    const monedas = Object.keys(uso).sort((a, b) => uso[b] - uso[a]);
    if (!monedas.length) monedas.push(ajuste('moneda'));
    const prevMoneda = balanceMoneda.value;
    balanceMoneda.innerHTML = monedas.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
    balanceMoneda.value = monedas.includes(prevMoneda) ? prevMoneda : monedas[0];

    fillBuildingSelect(balanceEdificio, 'Todos los edificios');
  }

  function renderBalance(){
    syncBalanceFilters();
    const anio = balanceAnio.value;
    const moneda = balanceMoneda.value;
    const edf = balanceEdificio.value;
    const ingresos = new Array(12).fill(0);
    const gastos = new Array(12).fill(0);
    const porEdificio = {};
    const porCategoria = {};
    const add = (obj, key, field, n) => { obj[key] = obj[key] || { ingresos:0, gastos:0 }; obj[key][field] += n; };

    db.pagos.forEach(pg => {
      if (!pg.fecha || pg.fecha.slice(0, 4) !== anio || pg.moneda !== moneda) return;
      const c = byId(db.contratos, pg.contratoId);
      const bId = c ? edificioIdDeContrato(c) : null;
      if (edf && bId !== edf) return;
      const n = Number(pg.monto) || 0;
      ingresos[Number(pg.fecha.slice(5, 7)) - 1] += n;
      add(porEdificio, bId || '', 'ingresos', n);
    });
    db.gastos.forEach(g => {
      if (!g.fecha || g.fecha.slice(0, 4) !== anio || g.moneda !== moneda) return;
      if (edf && g.edificioId !== edf) return;
      const n = Number(g.monto) || 0;
      gastos[Number(g.fecha.slice(5, 7)) - 1] += n;
      add(porEdificio, g.edificioId || '', 'gastos', n);
      porCategoria[g.categoria || 'Otros'] = (porCategoria[g.categoria || 'Otros'] || 0) + n;
    });

    const totIng = round2(ingresos.reduce((s, n) => s + n, 0));
    const totGas = round2(gastos.reduce((s, n) => s + n, 0));
    const neto = round2(totIng - totGas);
    const deuda = round2(db.contratos.filter(c => c.moneda === moneda && (!edf || edificioIdDeContrato(c) === edf))
      .reduce((s, c) => s + deudaDe(c).monto, 0));
    $('balanceStats').innerHTML = [
      stat('Ingresos ' + anio, esc(fmtMoney(totIng, moneda)), 'Pagos cobrados en el año', true),
      stat('Gastos ' + anio, esc(fmtMoney(totGas, moneda)), plural(db.gastos.filter(g => g.fecha && g.fecha.slice(0, 4) === anio && g.moneda === moneda && (!edf || g.edificioId === edf)).length, 'gasto registrado', 'gastos registrados'), true),
      stat('Resultado neto', esc((neto < 0 ? '−' : '') + fmtMoney(Math.abs(neto), moneda)), totIng ? 'Margen ' + Math.round(neto / totIng * 100) + '% de los ingresos' : 'Sin ingresos en el año', true),
      stat('Pendiente de cobro', esc(fmtMoney(deuda, moneda)), 'Cuotas vencidas sin pagar (a hoy)', true)
    ].join('');

    renderBalanceChart($('balanceChart'), ingresos, gastos, moneda, anio);

    const cats = Object.keys(porCategoria).sort((a, b) => porCategoria[b] - porCategoria[a]);
    const maxCat = cats.length ? porCategoria[cats[0]] : 0;
    $('balanceCategorias').innerHTML = cats.length
      ? '<div class="hbars">' + cats.map(cat =>
          '<div class="hbar-row" title="' + esc(cat + ': ' + fmtMoney(porCategoria[cat], moneda) + ' (' + Math.round(porCategoria[cat] / totGas * 100) + '% de los gastos)') + '">' +
            '<span class="hbar-label">' + esc(cat) + '</span>' +
            '<span class="hbar-track"><span class="hbar-fill" style="width:' + Math.max(1, porCategoria[cat] / maxCat * 100) + '%"></span></span>' +
            '<span class="hbar-value">' + esc(fmtNumber(porCategoria[cat])) + '</span></div>').join('') + '</div>'
      : emptyState('Sin gastos', 'No hay gastos en ' + moneda + ' en ' + anio + '.');

    const filas = Object.keys(porEdificio).map(id => ({ id, nombre: id ? ((byId(db.edificios, id) || {}).nombre || '(edificio eliminado)') : '(sin edificio)', ...porEdificio[id] }))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    $('balanceEdificios').innerHTML = filas.length
      ? '<table class="data-table compact"><thead><tr><th>Edificio</th><th class="num">Ingresos</th><th class="num">Gastos</th><th class="num">Neto</th></tr></thead><tbody>' +
        filas.map(f => '<tr><td>' + esc(f.nombre) + '</td><td class="num">' + esc(fmtNumber(f.ingresos)) + '</td><td class="num">' + esc(fmtNumber(f.gastos)) + '</td>' +
          '<td class="num' + (f.ingresos - f.gastos < 0 ? ' negative' : '') + '">' + esc((f.ingresos - f.gastos < 0 ? '−' : '') + fmtNumber(Math.abs(f.ingresos - f.gastos))) + '</td></tr>').join('') +
        '</tbody></table>'
      : emptyState('Sin movimientos', 'No hay ingresos ni gastos en ' + moneda + ' en ' + anio + '.');

    $('balanceTabla').innerHTML = '<table class="data-table"><thead><tr><th>Mes</th><th class="num">Ingresos</th><th class="num">Gastos</th><th class="num">Neto</th></tr></thead><tbody>' +
      ingresos.map((ing, i) => {
        const n = round2(ing - gastos[i]);
        return '<tr><td>' + esc(MESES[i].charAt(0).toUpperCase() + MESES[i].slice(1)) + '</td><td class="num">' + esc(fmtNumber(ing)) + '</td><td class="num">' + esc(fmtNumber(gastos[i])) + '</td>' +
          '<td class="num' + (n < 0 ? ' negative' : '') + '">' + esc((n < 0 ? '−' : '') + fmtNumber(Math.abs(n))) + '</td></tr>';
      }).join('') +
      '<tr class="total-row"><td>Total ' + esc(anio) + '</td><td class="num">' + esc(fmtNumber(totIng)) + '</td><td class="num">' + esc(fmtNumber(totGas)) + '</td>' +
        '<td class="num' + (neto < 0 ? ' negative' : '') + '">' + esc((neto < 0 ? '−' : '') + fmtNumber(Math.abs(neto))) + '</td></tr>' +
      '</tbody></table>';
  }

  // Marcas del eje con un paso "redondo" (1, 2, 2.5 o 5 por potencia de
  // 10), unas 4 divisiones, y el máximo en la primera marca que cubre v.
  function niceTicks(v){
    if (!(v > 0)) return [0, 1];
    const raw = v / 4;
    const exp = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / exp;
    const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp;
    const ticks = [];
    for (let i = 0; i * step < v + step * 0.001; i++) ticks.push(i * step);
    if (ticks[ticks.length - 1] < v) ticks.push(ticks.length * step);
    return ticks;
  }
  function compactNumber(n){
    const trim = (x) => String(Math.round(x * 10) / 10);
    if (n >= 1e6) return trim(n / 1e6) + 'M';
    if (n >= 1e3) return trim(n / 1e3) + 'K';
    return String(Math.round(n));
  }

  // Columnas agrupadas (ingresos / gastos) por mes, con un solo eje.
  // Cada mes es una zona de hover que muestra el detalle en un tooltip.
  function renderBalanceChart(el, ingresos, gastos, moneda, anio){
    const ticks = niceTicks(Math.max(...ingresos, ...gastos));
    const max = ticks[ticks.length - 1];
    const pct = (n) => (n / max * 100).toFixed(2) + '%';
    el.innerHTML =
      '<div class="chart" role="img" aria-label="Ingresos y gastos por mes de ' + esc(anio) + ' en ' + esc(moneda) + '. El detalle está en la tabla mensual.">' +
        '<div class="chart-yaxis">' + ticks.map(t => '<span style="bottom:' + pct(t) + '">' + esc(compactNumber(t)) + '</span>').join('') + '</div>' +
        '<div class="chart-plot">' +
          ticks.map(t => '<span class="chart-grid' + (t === 0 ? ' base' : '') + '" style="bottom:' + pct(t) + '"></span>').join('') +
          '<div class="chart-cols">' + ingresos.map((ing, i) =>
            '<div class="chart-group" tabindex="0" data-i="' + i + '" style="--i:' + i + '">' +
              '<span class="bar bar-ing" style="height:' + pct(ing) + '"></span>' +
              '<span class="bar bar-gas" style="height:' + pct(gastos[i]) + '"></span>' +
            '</div>').join('') + '</div>' +
          '<div class="chart-tip" hidden></div>' +
        '</div>' +
        '<div class="chart-xaxis">' + MESES_CORTOS.map(m => '<span>' + m + '</span>').join('') + '</div>' +
      '</div>';

    const plot = el.querySelector('.chart-plot');
    const tip = el.querySelector('.chart-tip');
    const show = (group) => {
      const i = Number(group.dataset.i);
      const n = round2(ingresos[i] - gastos[i]);
      tip.innerHTML = '<strong>' + esc(MESES[i].charAt(0).toUpperCase() + MESES[i].slice(1) + ' ' + anio) + '</strong>' +
        '<span><i class="sw sw-ing"></i>Ingresos<b>' + esc(fmtMoney(ingresos[i], moneda)) + '</b></span>' +
        '<span><i class="sw sw-gas"></i>Gastos<b>' + esc(fmtMoney(gastos[i], moneda)) + '</b></span>' +
        '<span class="tip-net">Neto<b>' + esc((n < 0 ? '−' : '') + fmtMoney(Math.abs(n), moneda)) + '</b></span>';
      tip.hidden = false;
      const g = group.getBoundingClientRect();
      const p = plot.getBoundingClientRect();
      const left = Math.min(Math.max(g.left - p.left + g.width / 2 - tip.offsetWidth / 2, 0), p.width - tip.offsetWidth);
      tip.style.left = left + 'px';
      el.querySelectorAll('.chart-group.hover').forEach(x => x.classList.remove('hover'));
      group.classList.add('hover');
    };
    const hide = () => { tip.hidden = true; el.querySelectorAll('.chart-group.hover').forEach(x => x.classList.remove('hover')); };
    el.querySelectorAll('.chart-group').forEach(group => {
      group.addEventListener('mouseenter', () => show(group));
      group.addEventListener('focus', () => show(group));
      group.addEventListener('blur', hide);
    });
    plot.addEventListener('mouseleave', hide);
  }

  // ---------------------------------------------------------------
  // Propietarios y liquidaciones.
  //
  // El abogado cobra los alquileres y cada mes hace la liquidación de cada
  // edificio para cobrarse su comisión: la de cada apartamento es la del
  // edificio salvo que tenga una propia. Al propietario se le transfiere
  // lo cobrado − la comisión (− los gastos, si en Configuración ese
  // edificio los descuenta). Un apartamento es del propietario del
  // edificio salvo que tenga uno propio, así que un edificio puede tener
  // una liquidación por cada dueño. Se calcula por moneda.
  //
  // Al registrar la liquidación se guarda una foto de los importes
  // (db.liquidaciones) para que quede constancia aunque después cambien
  // los pagos o gastos de ese mes; si cambian, se avisa de la diferencia.
  // ---------------------------------------------------------------
  const COMISION_TIPOS = [
    { value:'porcentaje', label:'Porcentaje de lo cobrado' },
    { value:'fijo', label:'Monto fijo por apartamento alquilado' },
    { value:'ninguna', label:'Sin comisión' }
  ];

  function propietarioOptions(emptyLabel){
    return [{ value:'', label:emptyLabel }].concat(
      db.propietarios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => ({ value:p.id, label:p.nombre })));
  }

  // Si el formulario trae un nombre en "propietarioNuevo", lo crea (o
  // reutiliza el que ya tenga ese nombre) y devuelve su id.
  function takeNewPropietario(values){
    const nombre = String(values.propietarioNuevo || '').trim();
    delete values.propietarioNuevo;
    if (!nombre) return null;
    let p = db.propietarios.find(x => normalize(x.nombre) === normalize(nombre));
    if (!p) {
      p = { id: uid('prp'), creado: new Date().toISOString(), nombre };
      db.propietarios.push(p);
    }
    return p.id;
  }

  // Comisión del abogado de un edificio o apartamento ({ comisionTipo, comisionValor, comisionMoneda }).
  function comisionLabel(x){
    if (!x || !x.comisionTipo || x.comisionTipo === 'ninguna' || !(Number(x.comisionValor) > 0)) return 'Sin comisión';
    return x.comisionTipo === 'fijo' ? fmtMoney(x.comisionValor, x.comisionMoneda) + ' al mes' : fmtNumber(x.comisionValor).replace(/[.,]00$/, '') + '% de lo cobrado';
  }
  // La de un apartamento: la suya si la tiene; si no, la de su edificio.
  function comisionDeUnidad(u){
    return u && u.comisionTipo ? u : (edificioDe(u) || {});
  }
  // Por defecto los gastos se descuentan al propietario; en Configuración
  // se puede desactivar por edificio.
  function descuentaGastos(b){ return !b || b.descontarGastos !== false; }

  // ¿Estuvo alquilado el apartamento en algún día del mes? (para la comisión fija)
  function alquiladaEnMes(unidadId, periodo){
    const ini = periodo + '-01', fin = periodo + '-31';
    return db.contratos.some(c => c.unidadId === unidadId && (c.fechaInicio || '') <= fin &&
      (isActive(c) || (c.fechaFinalizacion || c.fechaFin || '') >= ini));
  }

  function inmueblesDe(propId){
    const edificios = db.edificios.filter(b => b.propietarioId === propId);
    const unidades = db.unidades.filter(u => propietarioIdDe(u) === propId);
    return { edificios, unidades };
  }

  // ---------- Propietarios ----------
  const searchPropietarios = $('searchPropietarios');
  searchPropietarios.addEventListener('input', renderPropietarios);

  function renderPropietarios(){
    const q = normalize(searchPropietarios.value);
    const el = $('tablePropietarios');
    if (!db.propietarios.length) {
      el.innerHTML = emptyState('Todavía no hay propietarios', 'Dueños y su cuenta bancaria.', '<button type="button" class="btn-brass" data-act="nuevo-propietario">+ Nuevo propietario</button>');
      return;
    }
    const list = db.propietarios
      .filter(p => !q || normalize([p.nombre, p.documento, p.telefono, p.email].join(' ')).includes(q))
      .sort((a, b) => a.nombre.localeCompare(b.nombre));
    if (!list.length) { el.innerHTML = emptyState('Sin resultados', 'Ningún propietario coincide con la búsqueda.'); return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Propietario</th><th>Contacto</th><th>Inmuebles</th><th>Cuenta para transferir</th><th></th></tr></thead><tbody>' +
      list.map(p => {
        const inm = inmueblesDe(p.id);
        const ocupados = inm.unidades.filter(u => activeContractOfUnit(u.id)).length;
        const nombresEdificios = inm.edificios.map(b => b.nombre).join(', ');
        return '<tr><td><span class="cell-main">' + esc(p.nombre) + '</span>' + (p.documento ? '<span class="cell-sub">' + esc(p.documento) + '</span>' : '') + '</td>' +
          '<td>' + (p.telefono ? esc(p.telefono) : '<span class="muted">—</span>') + (p.email ? '<span class="cell-sub">' + esc(p.email) + '</span>' : '') + '</td>' +
          '<td>' + (inm.unidades.length ? plural(inm.unidades.length, 'apartamento', 'apartamentos') + ' · ' + ocupados + ' ocupados' : '<span class="muted">Ninguno</span>') +
            (nombresEdificios ? '<span class="cell-sub">' + esc(nombresEdificios) + '</span>' : '') + '</td>' +
          '<td>' + (p.cuenta ? esc(p.cuenta) + '<span class="cell-sub">' + esc([p.banco, p.titular].filter(Boolean).join(' · ')) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td><div class="row-actions">' +
            '<button type="button" class="btn-brass" data-act="ver-liquidacion" data-id="' + esc(p.id) + '">Liquidación</button>' +
            '<button type="button" class="btn-panel" data-act="editar-propietario" data-id="' + esc(p.id) + '">Editar</button>' +
            '<button type="button" class="btn-wine" data-act="borrar-propietario" data-id="' + esc(p.id) + '">Eliminar</button>' +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  const PROPIETARIO_FIELDS = [
    { name:'nombre', label:'Nombre completo o empresa', required:true, full:true },
    { name:'documento', label:'Cédula / RNC', documento:'cedula-rnc', placeholder:'Cédula o RNC' },
    { name:'telefono', label:'Teléfono', type:'tel' },
    { name:'email', label:'Correo electrónico', type:'email' },
    { name:'direccion', label:'Domicilio' },
    { name:'banco', label:'Banco' },
    { name:'cuenta', label:'No. de cuenta' },
    { name:'titular', label:'Titular de la cuenta', full:true, placeholder:'Si es distinto del propietario' },
    { name:'notas', label:'Notas', type:'textarea', full:true }
  ];

  function openPropietarioForm(id){
    const current = id ? byId(db.propietarios, id) : null;
    openForm({
      title: current ? 'Editar propietario' : 'Nuevo propietario',
      fields: PROPIETARIO_FIELDS.map(f => f.name !== 'documento' ? f : Object.assign({}, f, {
        autocompletar: { tipo:'propietario', excluir: current && current.id,
          campos: { nombre:'nombre', telefono:'telefono', email:'email', direccion:'direccion' } }
      })),
      values: current || {},
      async onSave(values){
        const repetido = db.propietarios.find(p => p.id !== (current && current.id) && normalize(p.nombre) === normalize(values.nombre));
        if (repetido) return 'Ya hay un propietario llamado "' + repetido.nombre + '".';
        if (current) Object.assign(current, values);
        else db.propietarios.push(Object.assign({ id: uid('prp'), creado: new Date().toISOString() }, values));
        return persist();
      }
    });
  }

  async function deletePropietario(id){
    const p = byId(db.propietarios, id);
    if (!p) return;
    const inm = inmueblesDe(id);
    const asignados = inm.edificios.length + db.unidades.filter(u => u.propietarioId === id).length;
    if (asignados) {
      await ui.showNotice(p.nombre + ' está asignado a ' + plural(asignados, 'inmueble', 'inmuebles') + '. Asigna esos edificios o apartamentos a otro propietario antes de eliminarlo.', 'No se puede eliminar');
      return;
    }
    const registradas = db.liquidaciones.filter(l => l.propietarioId === id).sort((a, b) => b.periodo.localeCompare(a.periodo));
    if (registradas.length) {
      const meses = [...new Set(registradas.map(l => fmtPeriodo(l.periodo)))];
      const ver = await ui.showConfirmDialog(p.nombre + ' tiene ' + plural(registradas.length, 'liquidación registrada', 'liquidaciones registradas') + ' (' + meses.join(', ') +
        '). Para conservar la contabilidad no se puede eliminar. Si alguna fue un error, anúlala primero en Liquidaciones. ¿Ir a ' + (meses.length > 1 ? 'la más reciente' : 'ella') + '?', 'No se puede eliminar');
      if (ver) {
        liqMes.value = registradas[0].periodo;
        setLiqModo('mes');
        liqPropFiltro = id;
        showView('liquidaciones');
      }
      return;
    }
    if (!(await ui.showConfirmDialog('¿Eliminar al propietario ' + p.nombre + '?', 'Eliminar propietario'))) return;
    db.propietarios = db.propietarios.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // ---------- Cálculo de liquidaciones ----------
  // Devuelve una fila por edificio, propietario y moneda con movimientos en el mes:
  // { edificio, propietario, moneda, ingresos, retenciones, gastos, comision,
  //   itbisComision, neto, descuentaGastos, unidades:[{ unidad, ingresos, comision, comisionLabel, pagos }],
  //   pagos, gastosLista, registro }
  // Las liquidaciones registradas antes de que fueran por edificio (solo
  // por propietario) salen como filas "anterior" con los importes guardados.
  function liquidacionesDelMes(periodo){
    const filas = new Map();
    const fila = (edificioId, propId, moneda) => {
      const key = edificioId + '|' + propId + '|' + moneda;
      if (!filas.has(key)) filas.set(key, { edificioId, propietarioId: propId, moneda, ingresos:0, retenciones:0, gastos:0, comision:0, itbisComision:0, porUnidad: new Map(), pagos:[], gastosLista:[] });
      return filas.get(key);
    };
    const deUnidad = (f, u) => {
      if (!f.porUnidad.has(u.id)) f.porUnidad.set(u.id, { unidad: u, ingresos:0, comision:0, pagos:[] });
      return f.porUnidad.get(u.id);
    };
    db.pagos.forEach(pg => {
      if (monthOf(pg.fecha) !== periodo) return;
      const c = byId(db.contratos, pg.contratoId);
      const u = c ? byId(db.unidades, c.unidadId) : null;
      const propId = propietarioIdDe(u);
      if (!propId) return;
      const f = fila(u.edificioId, propId, pg.moneda || '');
      f.ingresos += Number(pg.monto) || 0;
      f.retenciones += Number(pg.retencion) || 0;
      f.pagos.push(pg);
      const pu = deUnidad(f, u);
      pu.ingresos += Number(pg.monto) || 0;
      pu.pagos.push(pg);
    });
    db.gastos.forEach(g => {
      if (monthOf(g.fecha) !== periodo) return;
      const u = g.unidadId ? byId(db.unidades, g.unidadId) : null;
      const edificioId = u ? u.edificioId : g.edificioId;
      const propId = u ? propietarioIdDe(u) : (byId(db.edificios, edificioId) || {}).propietarioId;
      if (!propId || !descuentaGastos(byId(db.edificios, edificioId))) return;
      const f = fila(edificioId, propId, g.moneda || '');
      f.gastos += Number(g.monto) || 0;
      f.gastosLista.push(g);
    });
    // Comisión fija: se cobra por cada apartamento alquilado en el mes, aunque no haya pagado.
    db.unidades.forEach(u => {
      const k = comisionDeUnidad(u);
      const propId = propietarioIdDe(u);
      if (propId && k.comisionTipo === 'fijo' && Number(k.comisionValor) > 0 && alquiladaEnMes(u.id, periodo)) deUnidad(fila(u.edificioId, propId, k.comisionMoneda || MONEDAS[0]), u);
    });
    // Una liquidación registrada se muestra siempre en su mes, aunque ya no
    // queden movimientos (p. ej. se borró un pago o el apartamento cambió de
    // dueño): así se ve la diferencia y se puede anular.
    db.liquidaciones.forEach(l => { if (l.periodo === periodo && l.edificioId) fila(l.edificioId, l.propietarioId, l.moneda || ''); });
    const itbis = Number(ajuste('itbisComision')) > 0 ? Number(ajuste('itbisComision')) : 0;
    const out = [...filas.values()].map(f => {
      f.unidades = [...f.porUnidad.values()].map(x => {
        const k = comisionDeUnidad(x.unidad);
        const v = Number(k.comisionValor);
        if (v > 0 && k.comisionTipo === 'porcentaje') x.comision = round2(x.ingresos * v / 100);
        if (v > 0 && k.comisionTipo === 'fijo' && (k.comisionMoneda || MONEDAS[0]) === f.moneda && alquiladaEnMes(x.unidad.id, periodo)) x.comision = round2(v);
        x.ingresos = round2(x.ingresos);
        x.comisionLabel = comisionLabel(k);
        return x;
      }).sort((a, b) => compareIds(a.unidad.identificador, b.unidad.identificador));
      delete f.porUnidad;
      f.ingresos = round2(f.ingresos);
      f.gastos = round2(f.gastos);
      f.retenciones = round2(f.retenciones);
      f.comision = round2(f.unidades.reduce((s, x) => s + x.comision, 0));
      // ITBIS de la comisión del abogado (Configuración), que paga el propietario.
      f.itbisComision = itbis ? round2(f.comision * itbis / 100) : 0;
      // El ISR retenido no llega en efectivo: se descuenta de lo que se transfiere
      // (el propietario lo usa como crédito fiscal).
      f.neto = round2(f.ingresos - f.retenciones - f.gastos - f.comision - f.itbisComision);
      f.edificio = byId(db.edificios, f.edificioId);
      f.propietario = byId(db.propietarios, f.propietarioId);
      f.descuentaGastos = descuentaGastos(f.edificio);
      f.registro = db.liquidaciones.find(l => l.edificioId === f.edificioId && l.propietarioId === f.propietarioId && l.periodo === periodo && l.moneda === f.moneda) || null;
      f.periodo = periodo;
      return f;
    }).filter(f => f.propietario);
    db.liquidaciones.forEach(l => {
      if (l.periodo !== periodo || l.edificioId) return;
      const p = byId(db.propietarios, l.propietarioId);
      if (p) out.push({ anterior:true, periodo, edificioId:'', edificio:null, propietarioId:l.propietarioId, propietario:p, moneda:l.moneda || '',
        ingresos:l.ingresos, retenciones:l.retenciones || 0, gastos:l.gastos, comision:l.comision, itbisComision:l.itbisComision || 0, neto:l.neto,
        descuentaGastos:true, unidades:[], pagos:[], gastosLista:[], registro:l });
    });
    return out;
  }

  // Sin registrar y con algo que liquidar: la comisión del abogado o un saldo para el propietario.
  function liqPendiente(f){ return !f.registro && (f.comision > 0 || f.neto > 0); }
  function edificioNombre(f){ return f.anterior ? 'Liquidación anterior (por propietario)' : (f.edificio ? f.edificio.nombre : '(edificio eliminado)'); }
  function ordenLiq(a, b){
    return edificioNombre(a).localeCompare(edificioNombre(b)) || a.propietario.nombre.localeCompare(b.propietario.nombre) || a.moneda.localeCompare(b.moneda);
  }

  // Todas las liquidaciones, de todos los meses con movimientos (del
  // primer pago, gasto, contrato o registro hasta el mes actual).
  function liquidacionesDeTodo(){
    const meses = [];
    db.pagos.forEach(x => x.fecha && meses.push(monthOf(x.fecha)));
    db.gastos.forEach(x => x.fecha && meses.push(monthOf(x.fecha)));
    db.contratos.forEach(x => x.fechaInicio && meses.push(monthOf(x.fechaInicio)));
    db.liquidaciones.forEach(x => x.periodo && meses.push(x.periodo));
    const hasta = monthOf(todayStr());
    let mes = meses.filter(Boolean).sort()[0];
    if (!mes) return [];
    const out = [];
    for (let n = 0; mes <= hasta && n < 240; n++, mes = addMonthsP(mes, 1)) out.push(...liquidacionesDelMes(mes));
    return out;
  }

  // ---------- Vista Liquidaciones ----------
  // "Por mes" muestra un mes; "Todo", todas las liquidaciones juntas con su
  // mes, para no perder ninguna. El estado (pendiente / registrada) filtra en ambos.
  const liqMes = $('liqMes');
  const liqPropietario = $('liqPropietario');
  const liqEstado = $('liqEstado');
  let liqModo = 'mes';
  liqMes.value = addMonthsP(monthOf(todayStr()), -1);
  liqMes.addEventListener('input', () => { if (liqMes.value) renderLiquidaciones(); });
  liqEstado.addEventListener('input', renderLiquidaciones);
  function setLiqModo(modo){
    liqModo = modo === 'todo' ? 'todo' : 'mes';
    document.querySelectorAll('[data-liq-modo]').forEach(b => {
      b.classList.toggle('active', b.dataset.liqModo === liqModo);
      b.setAttribute('aria-pressed', b.dataset.liqModo === liqModo ? 'true' : 'false');
    });
    $('liqMesControles').hidden = liqModo === 'todo';
    $('btnEnvioEstados').hidden = liqModo === 'todo';
  }
  document.querySelectorAll('[data-liq-modo]').forEach(b => b.addEventListener('click', () => { setLiqModo(b.dataset.liqModo); renderLiquidaciones(); }));
  // El filtro se guarda aparte porque el <select> se reconstruye en cada render.
  let liqPropFiltro = '';
  liqPropietario.addEventListener('input', () => { liqPropFiltro = liqPropietario.value; renderLiquidaciones(); });
  $('liqPrev').addEventListener('click', () => { liqMes.value = addMonthsP(liqMes.value || monthOf(todayStr()), -1); renderLiquidaciones(); });
  $('liqNext').addEventListener('click', () => { liqMes.value = addMonthsP(liqMes.value || monthOf(todayStr()), 1); renderLiquidaciones(); });

  function liqKey(f){ return f.periodo + '|' + (f.anterior ? 'anterior|' + f.registro.id : f.edificioId + '|' + f.propietarioId + '|' + f.moneda); }

  function renderLiquidaciones(){
    liqPropietario.innerHTML = propietarioOptions('Todos los propietarios').map(o => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('');
    liqPropietario.value = byId(db.propietarios, liqPropFiltro) ? liqPropFiltro : '';
    const periodo = liqMes.value || monthOf(todayStr());
    const todo = liqModo === 'todo';
    const filas = (todo ? liquidacionesDeTodo() : liquidacionesDelMes(periodo))
      .filter(f => !liqPropietario.value || f.propietarioId === liqPropietario.value)
      .filter(f => !liqEstado.value || (liqEstado.value === 'pendientes' ? !f.registro : !!f.registro))
      .sort((a, b) => b.periodo.localeCompare(a.periodo) || ordenLiq(a, b));
    const pendientes = filas.filter(f => !f.registro);
    const desde = filas.length ? filas[filas.length - 1].periodo : periodo;

    $('liqStats').innerHTML = [
      stat('Tu comisión', moneyLines(sumByMoneda(filas, f => f.comision, f => f.moneda)), todo ? 'Desde ' + fmtPeriodo(desde) : 'Lo que te corresponde como abogado', true),
      stat(todo ? 'Cobrado' : 'Cobrado en ' + MESES[Number(periodo.slice(5)) - 1], moneyLines(sumByMoneda(filas, f => f.ingresos, f => f.moneda)), todo ? 'Pagos de inquilinos' : 'Pagos de inquilinos del mes', true),
      stat('Por transferir a propietarios', moneyLines(sumByMoneda(pendientes.filter(f => f.neto > 0), f => f.neto, f => f.moneda)), pendientes.length ? plural(pendientes.length, 'liquidación pendiente', 'liquidaciones pendientes') : 'Todo liquidado', true),
      stat('Ya transferido', moneyLines(sumByMoneda(filas.filter(f => f.registro), f => f.registro.montoTransferido, f => f.moneda)), plural(filas.filter(f => f.registro).length, 'liquidación registrada', 'liquidaciones registradas'), true)
    ].join('');

    $('liqTitulo').textContent = todo ? 'Todas las liquidaciones' + (filas.length ? ' · ' + filas.length : '') : 'Liquidaciones de ' + fmtPeriodo(periodo);
    if (!db.edificios.length) {
      $('liqTabla').innerHTML = emptyState('Primero registra los edificios', 'Cada edificio lleva tu comisión.', '<button type="button" class="btn-brass" data-act="nuevo-edificio">+ Nuevo edificio</button>');
      return;
    }
    if (!filas.length && (todo || liqEstado.value)) {
      $('liqTabla').innerHTML = emptyState('Sin liquidaciones', liqEstado.value ? 'Ninguna coincide con el filtro.' : 'Todavía no hay pagos ni gastos.');
      return;
    }
    if (!filas.length) {
      const sinDueno = db.edificios.filter(b => !b.propietarioId).length;
      $('liqTabla').innerHTML = emptyState('Sin movimientos en ' + fmtPeriodo(periodo), sinDueno
        ? 'No hay pagos ni gastos este mes. Ojo: ' + plural(sinDueno, 'edificio no tiene', 'edificios no tienen') + ' propietario asignado, y sus movimientos no se liquidan.'
        : 'No hay pagos ni gastos este mes.');
      return;
    }
    $('liqTabla').innerHTML = '<table class="data-table"><thead><tr>' + (todo ? '<th>Mes</th>' : '') + '<th>Edificio</th><th class="num">Cobrado</th><th class="num">Gastos</th><th class="num">Tu comisión</th><th class="num">Al propietario</th><th>Estado</th><th></th></tr></thead><tbody>' +
      filas.map(f => {
        const p = f.propietario;
        const diferencia = f.registro ? round2(f.neto - f.registro.neto) : 0;
        let estado;
        if (!f.registro) estado = f.neto < 0 ? badge('parcial-atrasado', 'A cargo del propietario') : badge('pendiente', 'Pendiente');
        else estado = badge('pagado', (f.registro.montoTransferido < 0 ? 'Cobrado ' : 'Liquidado ') + fmtDate(f.registro.fecha)) +
          (Math.abs(diferencia) > 0.009 ? '<span class="cell-sub warn-text">Cambió ' + esc((diferencia > 0 ? '+' : '−') + fmtMoney(Math.abs(diferencia), f.moneda)) + ' desde que se registró</span>' : '');
        const desglose = f.unidades.length
          ? '<details class="liq-desglose"><summary>' + plural(f.unidades.length, 'apartamento', 'apartamentos') + '</summary><ul>' +
              f.unidades.map(x => '<li><span>Apto. ' + esc(x.unidad.identificador) + '</span><span>' + esc(fmtMoney(x.ingresos, f.moneda)) + ' cobrado · comisión ' +
                (x.comision ? esc(fmtMoney(x.comision, f.moneda)) : '—') + ' <span class="muted">(' + esc(x.comisionLabel) + ')</span></span></li>').join('') +
            '</ul></details>'
          : '';
        return '<tr>' + (todo ? '<td class="liq-mes">' + esc(fmtPeriodo(f.periodo)) + '</td>' : '') + '<td><span class="cell-main">' + esc(edificioNombre(f)) + '</span><span class="cell-sub">Propietario: ' + esc(p.nombre) +
            (p.cuenta ? ' · Cta. ' + esc(p.cuenta) : '') + '</span>' + desglose + '</td>' +
          '<td class="num">' + esc(fmtMoney(f.ingresos, f.moneda)) + (f.anterior ? '' : '<span class="cell-sub">' + plural(new Set(f.pagos.map(pg => pg.grupo || pg.id)).size, 'pago', 'pagos') + '</span>') +
            (f.retenciones ? '<span class="cell-sub">ISR retenido ' + esc(fmtMoney(f.retenciones, f.moneda)) + '</span>' : '') + '</td>' +
          '<td class="num">' + (!f.descuentaGastos ? '<span class="muted">No se descuentan</span>'
            : f.gastos ? esc(fmtMoney(f.gastos, f.moneda)) + (f.anterior ? '' : '<span class="cell-sub">' + plural(f.gastosLista.length, 'gasto', 'gastos') + '</span>') : '<span class="muted">—</span>') + '</td>' +
          '<td class="num">' + (f.comision ? '<span class="cell-main">' + esc(fmtMoney(f.comision, f.moneda)) + '</span>' + (f.itbisComision ? '<span class="cell-sub">+ ITBIS ' + esc(fmtMoney(f.itbisComision, f.moneda)) + '</span>' : '') : '<span class="muted">—</span>') + '</td>' +
          '<td class="num"><span class="' + (f.neto < 0 ? 'negative' : '') + '">' + esc((f.neto < 0 ? '−' : '') + fmtMoney(Math.abs(f.neto), f.moneda)) + '</span></td>' +
          '<td>' + estado + '</td>' +
          '<td><div class="row-actions">' +
            (f.anterior ? '' : '<button type="button" class="btn-panel" data-act="estado-cuenta" data-id="' + esc(liqKey(f)) + '">Imprimir</button>') +
            (f.registro
              ? '<button type="button" class="btn-panel" data-act="anular-liquidacion" data-id="' + esc(f.registro.id) + '">Anular registro</button>'
              : '<button type="button" class="btn-brass" data-act="registrar-liquidacion" data-id="' + esc(liqKey(f)) + '">' + (f.neto < 0 ? 'Registrar cobro' : 'Registrar liquidación') + '</button>') +
          '</div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  // La clave empieza por el mes (AAAA-MM), así sirve en cualquiera de los dos modos.
  function filaDeLiquidacion(key){
    const periodo = String(key || '').split('|')[0];
    return /^\d{4}-\d{2}$/.test(periodo) ? liquidacionesDelMes(periodo).find(f => liqKey(f) === key) || null : null;
  }

  function openLiquidacionForm(key){
    const f = filaDeLiquidacion(key);
    if (!f || f.anterior) return;
    const periodo = f.periodo;
    const p = f.propietario;
    const aCargo = f.neto < 0;
    openForm({
      title: aCargo ? 'Registrar cobro al propietario' : 'Registrar liquidación',
      subtitle: edificioNombre(f) + ' · ' + p.nombre + ' · ' + fmtPeriodo(periodo) + ' · Tu comisión: ' + fmtMoney(f.comision + f.itbisComision, f.moneda) + '. ' + (aCargo
        ? 'Lo descontado supera lo cobrado: el propietario debe ' + fmtMoney(Math.abs(f.neto), f.moneda) + '.'
        : 'Al propietario le corresponden ' + fmtMoney(f.neto, f.moneda) + (p.cuenta ? ', a la cuenta ' + p.cuenta + (p.banco ? ' (' + p.banco + ')' : '') : '') + '.'),
      fields: [
        { name:'fecha', label:'Fecha', type:'date', required:true },
        { name:'monto', label: aCargo ? 'Monto cobrado al propietario' : 'Monto transferido al propietario', type:'number', required:true, min:0, step:'0.01' },
        { name:'metodo', label:'Método', type:'select', options: METODOS_PAGO.map(m => ({ value:m, label:m })) },
        { name:'referencia', label:'Referencia / No. de transacción' },
        { name:'notas', label:'Notas', type:'textarea', full:true }
      ],
      values: { fecha: todayStr(), monto: Math.abs(f.neto), metodo: METODOS_PAGO[0] },
      async onSave(values){
        if (Math.abs(values.monto - Math.abs(f.neto)) > 0.009) {
          const ok = await ui.showConfirmDialog('El monto (' + fmtMoney(values.monto, f.moneda) + ') no coincide con lo calculado (' + fmtMoney(Math.abs(f.neto), f.moneda) + '). ¿Registrarlo de todos modos?', 'Monto distinto');
          if (!ok) return false;
        }
        db.liquidaciones.push({
          id: uid('liq'), creado: new Date().toISOString(),
          edificioId: f.edificioId, propietarioId: f.propietarioId, periodo, moneda: f.moneda,
          ingresos: f.ingresos, retenciones: f.retenciones, gastos: f.gastos, comision: f.comision, itbisComision: f.itbisComision, neto: f.neto,
          unidades: f.unidades.map(x => ({ unidadId: x.unidad.id, ingresos: x.ingresos, comision: x.comision })),
          montoTransferido: aCargo ? -values.monto : values.monto,
          fecha: values.fecha, metodo: values.metodo, referencia: values.referencia, notas: values.notas
        });
        return persist();
      }
    });
  }

  async function anularLiquidacion(id){
    const l = byId(db.liquidaciones, id);
    if (!l) return;
    const p = byId(db.propietarios, l.propietarioId);
    const b = l.edificioId ? byId(db.edificios, l.edificioId) : null;
    const ok = await ui.showConfirmDialog('¿Anular el registro de la liquidación de ' + (b ? b.nombre + ' (' + (p ? p.nombre : 'propietario') + ')' : (p ? p.nombre : 'este propietario')) + ' de ' + fmtPeriodo(l.periodo) +
      ' (' + fmtMoney(Math.abs(l.montoTransferido), l.moneda) + ', ' + fmtDate(l.fecha) + ')? Volverá a quedar pendiente.', 'Anular registro');
    if (!ok) return;
    db.liquidaciones = db.liquidaciones.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // Liquidación imprimible de un edificio (y propietario) para un mes y una moneda.
  async function printEstadoCuenta(key){
    const f = filaDeLiquidacion(key);
    if (!f || f.anterior) return;
    await printHtml(estadoCuentaHtml(f, f.periodo), tituloEstadoCuenta(f, f.periodo));
  }
  function tituloEstadoCuenta(f, periodo){
    const limpio = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_');
    return 'Liquidacion_' + limpio(edificioNombre(f)) + '_' + limpio(f.propietario.nombre) + '_' + periodo;
  }
  function estadoCuentaHtml(f, periodo){
    const p = f.propietario;
    const money = (n) => esc(fmtMoney(n, f.moneda));
    const th = (t, right) => '<th style="text-align:' + (right ? 'right' : 'left') + ';border-bottom:1.5px solid #333;padding:5px 6px;font-size:9.5pt;">' + t + '</th>';
    const td = (t, right) => '<td style="text-align:' + (right ? 'right' : 'left') + ';border-bottom:1px solid #ddd;padding:5px 6px;font-size:10pt;' + (right ? 'white-space:nowrap;' : '') + '">' + t + '</td>';
    const unidadesRows = f.unidades.map(x => {
      const nombres = [...new Set(x.pagos.map(pg => nombresInquilinos(byId(db.contratos, pg.contratoId) || {})).filter(Boolean))].join(', ');
      return '<tr>' + td('Apto. ' + esc(x.unidad.identificador)) + td(esc(nombres || '—')) + td(esc(x.comisionLabel)) + td(money(x.ingresos), true) + td(money(x.comision), true) + '</tr>';
    }).join('');
    const pagosRows = f.pagos.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map(pg => {
      const c = byId(db.contratos, pg.contratoId) || {};
      const t = byId(db.inquilinos, c.inquilinoId) || {};
      return '<tr>' + td(esc(fmtDate(pg.fecha))) + td(esc(t.nombre || '—')) + td(esc((byId(db.unidades, c.unidadId) || {}).identificador || '—')) + td(esc(fmtPeriodo(pg.periodo))) +
        td('No. ' + esc(String(pg.numero || '').padStart(5, '0'))) + td(money(pg.monto), true) + '</tr>';
    }).join('');
    const gastosRows = f.gastosLista.slice().sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map(g => {
      const l = gastoLugar(g);
      return '<tr>' + td(esc(fmtDate(g.fecha))) + td(esc(l.lugar)) + td(esc(g.categoria || '')) + td(esc(g.descripcion) + (g.proveedor ? ' (' + esc(g.proveedor) + ')' : '')) + td(money(g.monto), true) + '</tr>';
    }).join('');
    const resumen = (label, value, bold) => '<tr><td style="padding:4px 6px;' + (bold ? 'font-weight:bold;border-top:1.5px solid #333;' : '') + '">' + label + '</td>' +
      '<td style="padding:4px 6px;text-align:right;white-space:nowrap;' + (bold ? 'font-weight:bold;border-top:1.5px solid #333;' : '') + '">' + value + '</td></tr>';
    const r = f.registro;
    const bodyHtml =
      '<div style="max-width:720px;margin:0 auto;font-size:10.5pt;">' +
        '<table style="width:100%;border-collapse:collapse;"><tr>' +
          '<td style="vertical-align:top;"><div style="font-size:16pt;font-weight:bold;letter-spacing:.03em;">LIQUIDACIÓN</div>' +
            '<div style="color:#444;">' + esc(ajuste('despacho') || 'Administración de inmuebles') + ' · ' + esc(fmtPeriodo(periodo)) + ' · ' + esc(f.moneda) + '</div></td>' +
          '<td style="vertical-align:top;text-align:right;color:#444;">Emitido: ' + esc(fmtDate(todayStr())) + '</td>' +
        '</tr></table>' +
        '<div style="margin:16px 0;padding:10px 12px;border:1px solid #999;border-radius:4px;">' +
          '<b>' + esc(edificioNombre(f)) + '</b>' + (f.edificio && f.edificio.direccion ? ' · ' + esc(f.edificio.direccion) : '') +
          '<br>Propietario: ' + esc(p.nombre) + (p.documento ? ' · ' + esc(p.documento) : '') +
          (p.cuenta ? '<br>Cuenta: ' + esc(p.cuenta) + (p.banco ? ' · ' + esc(p.banco) : '') + (p.titular ? ' · Titular: ' + esc(p.titular) : '') : '') +
        '</div>' +
        '<div style="font-weight:bold;margin:14px 0 4px;">Comisión por apartamento</div>' +
        (unidadesRows ? '<table style="width:100%;border-collapse:collapse;"><tr>' + th('Apartamento') + th('Inquilino') + th('Comisión') + th('Cobrado', true) + th('Monto comisión', true) + '</tr>' + unidadesRows + '</table>' : '<div style="color:#666;">Sin apartamentos con movimientos este mes.</div>') +
        '<div style="font-weight:bold;margin:18px 0 4px;">Alquileres cobrados</div>' +
        (pagosRows ? '<table style="width:100%;border-collapse:collapse;"><tr>' + th('Fecha') + th('Inquilino') + th('Apto.') + th('Mes') + th('Recibo') + th('Monto', true) + '</tr>' + pagosRows + '</table>' : '<div style="color:#666;">Sin pagos cobrados este mes.</div>') +
        (f.descuentaGastos
          ? '<div style="font-weight:bold;margin:18px 0 4px;">Gastos</div>' +
            (gastosRows ? '<table style="width:100%;border-collapse:collapse;"><tr>' + th('Fecha') + th('Lugar') + th('Categoría') + th('Concepto') + th('Monto', true) + '</tr>' + gastosRows + '</table>' : '<div style="color:#666;">Sin gastos este mes.</div>')
          : '') +
        '<table style="width:360px;margin:20px 0 0 auto;border-collapse:collapse;">' +
          resumen('Total cobrado', money(f.ingresos)) +
          (f.retenciones ? resumen('ISR retenido por inquilinos (crédito fiscal)', '− ' + money(f.retenciones)) : '') +
          (f.descuentaGastos ? resumen('Gastos', '− ' + money(f.gastos)) : '') +
          resumen('Comisión del abogado', '− ' + money(f.comision)) +
          (f.itbisComision ? resumen('ITBIS de la comisión (' + esc(fmtNumber(ajuste('itbisComision')).replace(/[.,]00$/, '')) + '%)', '− ' + money(f.itbisComision)) : '') +
          resumen(f.neto < 0 ? 'Saldo a cargo del propietario' : 'Saldo a favor del propietario', money(Math.abs(f.neto)), true) +
        '</table>' +
        (r ? '<div style="margin-top:18px;padding:8px 12px;border:1px solid #999;border-radius:4px;">' + (r.montoTransferido < 0 ? 'Cobrado al propietario' : 'Transferido al propietario') + ' el ' + esc(fmtDate(r.fecha)) +
          ': <b>' + money(Math.abs(r.montoTransferido)) + '</b>' + (r.metodo ? ' · ' + esc(r.metodo) : '') + (r.referencia ? ' · Ref. ' + esc(r.referencia) : '') + '</div>' : '') +
      '</div>';
    return bodyHtml;
  }

  // ---------------------------------------------------------------
  // Reportes: morosidad por antigüedad, depósitos en custodia y
  // exportación de todo a un libro de Excel.
  // ---------------------------------------------------------------
  const TRAMOS = [
    { key:'t30', label:'1–30 días', max:30 },
    { key:'t60', label:'31–60 días', max:60 },
    { key:'t90', label:'61–90 días', max:90 },
    { key:'t90mas', label:'Más de 90', max:Infinity }
  ];

  // Una fila por contrato con deuda vencida, repartida por antigüedad.
  function morosidad(){
    const hoy = todayStr();
    return db.contratos.map(c => {
      const d = deudaDe(c);
      if (!(d.monto > 0)) return null;
      const fila = { c, total: d.monto, meses: d.meses, desde: d.primerPeriodo, t30:0, t60:0, t90:0, t90mas:0 };
      d.cuotas.forEach(q => {
        const dias = daysBetween(q.vence, hoy);
        const tramo = TRAMOS.find(t => dias <= t.max);
        fila[tramo.key] = round2(fila[tramo.key] + q.saldo);
      });
      return fila;
    }).filter(Boolean);
  }

  function depositosEnCustodia(){
    return db.contratos.filter(c => {
      const e = depositoEstado(c);
      return e && e.key === 'custodia';
    });
  }

  const repEdificio = $('repEdificio');
  const repMoneda = $('repMoneda');
  const repAnio = $('repAnio');
  [repEdificio, repMoneda].forEach(el => el.addEventListener('input', renderReportes));

  function renderReportes(){
    fillBuildingSelect(repEdificio, 'Todos los edificios');
    const uso = {};
    db.contratos.forEach(c => { if (c.moneda) uso[c.moneda] = (uso[c.moneda] || 0) + 1; });
    const monedas = Object.keys(uso).sort((a, b) => uso[b] - uso[a]);
    if (!monedas.length) monedas.push(ajuste('moneda'));
    const prevMoneda = repMoneda.value;
    repMoneda.innerHTML = monedas.map(m => '<option value="' + esc(m) + '">' + esc(m) + '</option>').join('');
    repMoneda.value = monedas.includes(prevMoneda) ? prevMoneda : monedas[0];

    const anios = new Set([String(new Date().getFullYear())]);
    db.pagos.forEach(pg => pg.fecha && anios.add(pg.fecha.slice(0, 4)));
    db.gastos.forEach(g => g.fecha && anios.add(g.fecha.slice(0, 4)));
    const prevAnio = repAnio.value;
    repAnio.innerHTML = '<option value="">Todos los años</option>' + [...anios].sort().reverse().map(a => '<option value="' + esc(a) + '">' + esc(a) + '</option>').join('');
    repAnio.value = prevAnio === '' || anios.has(prevAnio) ? prevAnio : String(new Date().getFullYear());

    const moneda = repMoneda.value;
    const edf = repEdificio.value;
    const enFiltro = (c) => c.moneda === moneda && (!edf || edificioIdDeContrato(c) === edf);
    const filas = morosidad().filter(f => enFiltro(f.c)).sort((a, b) => b.t90mas - a.t90mas || b.total - a.total);
    const suma = (k) => round2(filas.reduce((s, f) => s + f[k], 0));
    const depositos = depositosEnCustodia().filter(enFiltro);
    const money = (n) => esc(fmtMoney(n, moneda));

    $('repStats').innerHTML = [
      stat('Deuda vencida', money(suma('total')), plural(filas.length, 'contrato moroso', 'contratos morosos'), true),
      stat('Más de 90 días', money(suma('t90mas')), filas.filter(f => f.t90mas > 0).length ? plural(filas.filter(f => f.t90mas > 0).length, 'caso para gestión legal', 'casos para gestión legal') : 'Ningún caso', true),
      stat('31 a 90 días', money(round2(suma('t60') + suma('t90'))), 'Requieren seguimiento', true),
      stat('Depósitos en custodia', money(round2(depositos.reduce((s, c) => s + Number(c.deposito || 0), 0))), plural(depositos.length, 'depósito', 'depósitos') + ' a devolver al terminar', true)
    ].join('');

    $('repMorosidad').innerHTML = filas.length
      ? '<table class="data-table"><thead><tr><th>Inquilino</th>' + TRAMOS.map(t => '<th class="num">' + esc(t.label) + '</th>').join('') + '<th class="num">Total</th><th></th></tr></thead><tbody>' +
        filas.map(f => {
          const t = inquilinosDe(f.c)[0];
          return '<tr><td>' + (t ? '<button type="button" class="link-btn" data-act="ver-inquilino" data-id="' + esc(t.id) + '">' + esc(t.nombre) + '</button>' : '<span class="muted">—</span>') +
              '<span class="cell-sub">' + esc(unidadLabel(byId(db.unidades, f.c.unidadId))) + ' · ' + plural(f.meses, 'cuota', 'cuotas') + ' desde ' + esc(fmtPeriodo(f.desde)) + '</span></td>' +
            TRAMOS.map(tr => '<td class="num' + (tr.key === 't90mas' && f[tr.key] ? ' negative' : '') + '">' + (f[tr.key] ? esc(fmtNumber(f[tr.key])) : '<span class="muted">—</span>') + '</td>').join('') +
            '<td class="num"><span class="cell-main">' + esc(fmtNumber(f.total)) + '</span></td>' +
            '<td><div class="row-actions"><button type="button" class="btn-panel" data-act="recordar" data-id="' + esc(f.c.id) + '">Recordar</button>' +
              rowMenu([{ act:'estado-cuenta-inquilino', id:f.c.id, label:'Estado de cuenta' }, { act:'pagar', id:f.c.id, periodo:f.desde, label:'Registrar pago' }]) + '</div></td></tr>';
        }).join('') +
        '<tr class="total-row"><td>Total ' + esc(moneda) + '</td>' + TRAMOS.map(t => '<td class="num">' + esc(fmtNumber(suma(t.key))) + '</td>').join('') +
        '<td class="num">' + esc(fmtNumber(suma('total'))) + '</td><td></td></tr></tbody></table>'
      : emptyState('Sin morosidad', 'Ningún contrato en ' + moneda + (edf ? ' de este edificio' : '') + ' tiene cuotas vencidas sin pagar.');

    $('repDepositos').innerHTML = depositos.length
      ? '<table class="data-table compact"><thead><tr><th>Inquilino</th><th>Recibido</th><th class="num">Monto</th></tr></thead><tbody>' +
        depositos.map(c => '<tr><td>' + esc(nombresInquilinos(c)) + '<span class="cell-sub">' + esc(unidadLabel(byId(db.unidades, c.unidadId))) + (isActive(c) ? '' : ' · contrato finalizado, falta devolver') + '</span></td>' +
          '<td>' + esc(fmtDate((c.depositoInfo || {}).fechaRecibido)) + '</td><td class="num">' + esc(fmtNumber(c.deposito)) + '</td></tr>').join('') + '</tbody></table>'
      : emptyState('Sin depósitos en custodia', 'Se registran en el menú ⋯ del contrato.');
  }

  async function exportarExcel(){
    if (!window.rcExport) { await ui.showNotice('La exportación a Excel solo está disponible en la aplicación de escritorio.'); return; }
    const anio = repAnio.value;
    const enAnio = (fecha) => !anio || (fecha || '').slice(0, 4) === anio;
    const t1 = (c) => inquilinosDe(c)[0] || {};
    const unidad = (c) => byId(db.unidades, c.unidadId);
    const sheets = [
      { name:'Pagos', columns:[{ header:'Recibo', width:9 }, { header:'Fecha', type:'date', width:11 }, { header:'Mes que paga', width:14 }, { header:'Inquilino', width:26 },
          { header:'Documento', width:15 }, { header:'Edificio', width:22 }, { header:'Apartamento', width:12 }, { header:'Propietario', width:24 }, { header:'Método', width:13 },
          { header:'Referencia', width:16 }, { header:'Moneda', width:8 }, { header:'Monto', type:'money', width:14 }],
        rows: db.pagos.filter(pg => enAnio(pg.fecha)).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map(pg => {
          const c = byId(db.contratos, pg.contratoId) || {};
          const u = unidad(c);
          return [String(pg.numero || '').padStart(5, '0'), pg.fecha, pg.periodo, t1(c).nombre, t1(c).documento, (edificioDe(u) || {}).nombre, u && u.identificador,
            (propietarioDe(u) || {}).nombre, pg.metodo, pg.referencia, pg.moneda, pg.monto];
        }) },
      { name:'Gastos', columns:[{ header:'Fecha', type:'date', width:11 }, { header:'Edificio', width:22 }, { header:'Lugar', width:18 }, { header:'Categoría', width:15 },
          { header:'Concepto', width:34 }, { header:'Proveedor', width:20 }, { header:'Factura / NCF', width:15 }, { header:'Moneda', width:8 }, { header:'Monto', type:'money', width:14 }],
        rows: db.gastos.filter(g => enAnio(g.fecha)).sort((a, b) => (a.fecha || '').localeCompare(b.fecha || '')).map(g => {
          const l = gastoLugar(g);
          return [g.fecha, l.edificio, l.lugar, g.categoria, g.descripcion, g.proveedor, g.factura, g.moneda, g.monto];
        }) },
      { name:'Morosidad', columns:[{ header:'Inquilino', width:26 }, { header:'Teléfono', width:14 }, { header:'Edificio', width:22 }, { header:'Apartamento', width:12 },
          { header:'Moneda', width:8 }].concat(TRAMOS.map(t => ({ header:t.label, type:'money', width:13 })), [{ header:'Total', type:'money', width:14 }, { header:'Cuotas', type:'number', width:8 }, { header:'Desde', width:14 }]),
        rows: morosidad().map(f => {
          const u = unidad(f.c);
          return [t1(f.c).nombre, t1(f.c).telefono, (edificioDe(u) || {}).nombre, u && u.identificador, f.c.moneda].concat(TRAMOS.map(t => f[t.key]), [f.total, f.meses, fmtPeriodo(f.desde)]);
        }) },
      { name:'Contratos', columns:[{ header:'Inquilinos', width:30 }, { header:'Edificio', width:22 }, { header:'Apartamento', width:12 }, { header:'Propietario', width:24 },
          { header:'Inicio', type:'date', width:11 }, { header:'Fin', type:'date', width:11 }, { header:'Estado', width:11 }, { header:'Moneda', width:8 }, { header:'Alquiler', type:'money', width:13 },
          { header:'Depósito', type:'money', width:13 }, { header:'Estado del depósito', width:28 }, { header:'Recargo por mora', width:30 }, { header:'Fiador', width:24 }, { header:'Deuda vencida', type:'money', width:14 }],
        rows: db.contratos.map(c => {
          const u = unidad(c);
          return [nombresInquilinos(c), (edificioDe(u) || {}).nombre, u && u.identificador, (propietarioDe(u) || {}).nombre, c.fechaInicio, c.fechaFin, contractStatus(c).label, c.moneda, c.monto,
            c.deposito, (depositoEstado(c) || {}).label, hasMora(c) ? moraLabel(c) : '', c.fiadorNombre, deudaDe(c).monto];
        }) },
      { name:'Inquilinos', columns:[{ header:'Nombre', width:26 }, { header:'Documento', width:15 }, { header:'Nacionalidad', width:13 }, { header:'Estado civil', width:12 },
          { header:'Ocupación', width:18 }, { header:'Teléfono', width:14 }, { header:'Correo', width:24 }, { header:'Domicilio', width:30 }],
        rows: db.inquilinos.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(t => [t.nombre, t.documento, t.nacionalidad, t.estadoCivil, t.ocupacion, t.telefono, t.email, t.direccion]) },
      { name:'Propietarios', columns:[{ header:'Nombre', width:26 }, { header:'Documento', width:15 }, { header:'Teléfono', width:14 }, { header:'Correo', width:24 },
          { header:'Banco', width:18 }, { header:'Cuenta', width:18 }, { header:'Titular', width:22 }],
        rows: db.propietarios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(p => [p.nombre, p.documento, p.telefono, p.email, p.banco, p.cuenta, p.titular]) },
      { name:'Apartamentos', columns:[{ header:'Edificio', width:22 }, { header:'Apartamento', width:12 }, { header:'Piso', type:'number', width:6 }, { header:'Tipo', width:14 },
          { header:'Propietario', width:24 }, { header:'Comisión del abogado', width:22 }, { header:'Renta de referencia', type:'money', width:16 }, { header:'Estado', width:11 }, { header:'Inquilino actual', width:26 }],
        rows: db.unidades.slice().sort((a, b) => unidadLabel(a).localeCompare(unidadLabel(b), undefined, { numeric:true })).map(u => {
          const c = activeContractOfUnit(u.id);
          return [(edificioDe(u) || {}).nombre, u.identificador, u.piso, u.tipo, (propietarioDe(u) || {}).nombre, comisionLabel(comisionDeUnidad(u)), u.renta, c ? 'Ocupado' : 'Disponible', c ? nombresInquilinos(c) : ''];
        }) },
      { name:'Liquidaciones', columns:[{ header:'Mes', width:14 }, { header:'Edificio', width:22 }, { header:'Propietario', width:24 }, { header:'Moneda', width:8 }, { header:'Cobrado', type:'money', width:14 },
          { header:'Gastos', type:'money', width:13 }, { header:'Comisión del abogado', type:'money', width:14 }, { header:'ITBIS comisión', type:'money', width:13 }, { header:'Neto propietario', type:'money', width:14 }, { header:'Transferido', type:'money', width:14 },
          { header:'Fecha', type:'date', width:11 }, { header:'Referencia', width:16 }],
        rows: db.liquidaciones.filter(l => enAnio(l.periodo)).sort((a, b) => a.periodo.localeCompare(b.periodo)).map(l =>
          [fmtPeriodo(l.periodo), l.edificioId ? (byId(db.edificios, l.edificioId) || {}).nombre : '', (byId(db.propietarios, l.propietarioId) || {}).nombre, l.moneda, l.ingresos, l.gastos, l.comision, l.itbisComision || 0, l.neto, l.montoTransferido, l.fecha, l.referencia]) },
      { name:'Casos', columns:[{ header:'Caso', width:34 }, { header:'Tipo', width:26 }, { header:'Abierto', type:'date', width:11 }, { header:'Etapa', width:18 },
          { header:'Estado', width:10 }, { header:'Resultado', width:20 }, { header:'Tribunal', width:30 }, { header:'Expediente', width:14 }, { header:'Deuda al abrir', type:'money', width:14 }],
        rows: db.casos.slice().sort((a, b) => (a.abiertoEl || '').localeCompare(b.abiertoEl || '')).map(k =>
          [casoTitulo(k), tipoCasoLabel(k.tipo), k.abiertoEl, etapaLabel(k.etapa), casoAbierto(k) ? 'Abierto' : 'Cerrado', resultadoLabel(k.resultado), k.tribunal, k.numeroExpediente, k.deudaInicial]) },
      { name:'Agenda', columns:[{ header:'Fecha', type:'date', width:11 }, { header:'Hora', width:7 }, { header:'Tipo', width:11 }, { header:'Descripción', width:34 },
          { header:'Caso', width:34 }, { header:'Lugar', width:20 }, { header:'Hecho', width:7 }],
        rows: db.eventos.slice().sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || ''))).map(ev => {
          const k = ev.casoId ? byId(db.casos, ev.casoId) : null;
          return [ev.fecha, ev.hora, tipoEventoLabel(ev.tipo), ev.titulo, k ? casoTitulo(k) : '', ev.lugar, ev.hecho ? 'Sí' : 'No'];
        }) }
    ];
    const result = await window.rcExport.xlsx('RentHouse ' + (anio || 'completo') + ' ' + todayStr() + '.xlsx', sheets);
    const status = $('repExportStatus');
    if (result.canceled) return;
    if (!result.ok) { await ui.showNotice('No se pudo exportar: ' + result.error, 'Error al exportar'); return; }
    status.innerHTML = 'Guardado <b>' + esc(result.name) + '</b>. <button type="button" class="link-btn" id="repOpenExport">Abrir en Excel</button>';
    $('repOpenExport').addEventListener('click', () => window.rcExport.openLast());
  }

  // ---------- Aumento del alquiler ----------
  // Con "Aumento anual (%)" en el contrato se propone un aumento en cada
  // aniversario (o cada "aumentoCada" meses). Aplicarlo guarda el historial
  // en c.montos, así las cuotas anteriores conservan su monto.
  function proximoAumento(c){
    if (!isActive(c) || !(Number(c.aumentoPct) > 0) || !c.fechaInicio) return null;
    const cada = Number(c.aumentoCada) || 12;
    const ultimo = c.montos && c.montos.length ? c.montos[c.montos.length - 1].desde : monthOf(c.fechaInicio);
    const periodo = addMonthsP(ultimo, cada);
    if (periodo > lastPeriodOf(c)) return null;
    return { periodo, actual: Number(c.monto) || 0, nuevo: round2((Number(c.monto) || 0) * (1 + Number(c.aumentoPct) / 100)) };
  }
  // Aumentos que vencen dentro del aviso configurado (para el Resumen).
  function aumentosPorAplicar(){
    const limite = monthOf(addDays(todayStr(), ajuste('avisoDias')));
    return db.contratos.map(c => ({ c, a: proximoAumento(c) })).filter(x => x.a && x.a.periodo <= limite)
      .sort((a, b) => a.a.periodo.localeCompare(b.a.periodo));
  }

  function openAumentoForm(id){
    const c = byId(db.contratos, id);
    if (!c) return;
    const prop = proximoAumento(c);
    const siguiente = [addMonthsP(monthOf(todayStr()), 1), monthOf(c.fechaInicio)].sort()[1];
    openForm({
      title: 'Aplicar aumento',
      subtitle: contractTitle(c) + ' · hoy ' + fmtMoney(c.monto, c.moneda) + ' al mes' + (Number(c.aumentoPct) > 0 ? ' · aumento pactado: ' + fmtNumber(c.aumentoPct).replace(/[.,]00$/, '') + '%' : '') + '.',
      fields: [
        { name:'desde', label:'A partir de', type:'month', required:true },
        { name:'pct', label:'Aumento (%)', type:'number', min:0, max:100, step:'0.01' },
        { name:'monto', label:'Nuevo alquiler mensual', type:'number', required:true, min:0, step:'0.01' },
        { name:'avisar', label:'Preparar un aviso para el inquilino', type:'checkbox', full:true }
      ],
      values: { desde: prop ? prop.periodo : siguiente, pct: Number(c.aumentoPct) || null, monto: prop ? prop.nuevo : c.monto, avisar: true },
      onInput(form, name){
        const get = (n) => form.querySelector('[name="' + n + '"]');
        if (name === 'pct') get('monto').value = round2((Number(c.monto) || 0) * (1 + (Number(get('pct').value) || 0) / 100));
        if (name === 'monto' && c.monto > 0) get('pct').value = round2(((Number(get('monto').value) || 0) / c.monto - 1) * 100);
      },
      async onSave(v){
        if (!(v.monto > 0)) return 'Indica el nuevo alquiler.';
        if (v.desde < monthOf(c.fechaInicio)) return 'El contrato empieza el ' + fmtDate(c.fechaInicio) + ': el aumento debe aplicarse desde ese mes o después.';
        if (!contractCoversPeriod(c, v.desde)) return 'El contrato no cubre ' + fmtPeriodo(v.desde) + ' (termina el ' + fmtDate(c.fechaFin) + '). Para seguir después, renuévalo.';
        if (db.pagos.some(pg => pg.contratoId === c.id && pg.periodo >= v.desde) &&
          !(await ui.showConfirmDialog('Ya hay pagos registrados desde ' + fmtPeriodo(v.desde) + '. Sus cuotas pasarán a ' + fmtMoney(v.monto, c.moneda) + ' y podrían quedar con saldo. ¿Continuar?', 'Pagos ya registrados'))) return false;
        const anterior = c.monto;
        if (!c.montos || !c.montos.length) c.montos = [{ desde: monthOf(c.fechaInicio), monto: c.monto }];
        c.montos = c.montos.filter(x => x.desde < v.desde).concat({ desde: v.desde, monto: v.monto });
        c.monto = v.monto;
        const t = inquilinosDe(c)[0];
        if (t) t.seguimiento = (t.seguimiento || []).concat({ id: uid('nota'), fecha: new Date().toISOString(), texto: 'Aumento del alquiler: de ' + fmtMoney(anterior, c.moneda) + ' a ' + fmtMoney(v.monto, c.moneda) + ' desde ' + fmtPeriodo(v.desde) + '.' });
        const ok = await persist();
        if (ok && v.avisar && t) {
          setTimeout(() => abrirMensaje(c, 'Aviso de aumento del alquiler',
            'Estimado/a ' + t.nombre + ':\n\n' +
            'Conforme a lo pactado en su contrato de alquiler de ' + unidadLabel(byId(db.unidades, c.unidadId)) + ', le informamos que a partir de ' + fmtPeriodo(v.desde) +
            ' el alquiler mensual será de ' + fmtMoney(v.monto, c.moneda) + ' (antes ' + fmtMoney(anterior, c.moneda) + ').\n\n' +
            'Quedamos a su disposición para cualquier consulta.\n\nAtentamente,\n' + ajuste('firma') + (ajuste('despachoTelefono') ? '\nTel. ' + ajuste('despachoTelefono') : ''),
            'Aviso de aumento', t.nombre + ' · ' + fmtMoney(anterior, c.moneda) + ' → ' + fmtMoney(v.monto, c.moneda) + ' desde ' + fmtPeriodo(v.desde)), 50);
        }
        return ok;
      }
    });
  }

  // ---------- Estados de cuenta del mes a los propietarios ----------
  // Todas las liquidaciones de edificio con movimientos en un mes, cada una
  // para guardar en PDF y enviar al propietario por WhatsApp o correo. Lo
  // enviado se marca en el propietario (p.estadosEnviados: ['AAAA-MM|edificioId', ...];
  // los registros viejos, solo 'AAAA-MM', cuentan para todos sus edificios).
  const envioOverlay = $('envioOverlay');
  let envioPeriodo = null;

  function estadoEnviado(f, periodo){
    const enviados = f.propietario.estadosEnviados || [];
    return enviados.includes(periodo) || enviados.includes(periodo + '|' + f.edificioId);
  }
  function filasEstados(periodo){
    return liquidacionesDelMes(periodo).filter(f => !f.anterior).sort(ordenLiq);
  }
  function resumenEstado(f, periodo){
    const p = f.propietario;
    return 'Estimado/a ' + p.nombre + ':\n\n' +
      'Le compartimos la liquidación de ' + edificioNombre(f) + ' de ' + fmtPeriodo(periodo) + (f.moneda ? ' (' + f.moneda + ')' : '') + ':\n' +
      '• Alquileres cobrados: ' + fmtMoney(f.ingresos, f.moneda) + '\n' +
      (f.retenciones ? '• ISR retenido por inquilinos: ' + fmtMoney(f.retenciones, f.moneda) + '\n' : '') +
      (f.descuentaGastos ? '• Gastos: ' + fmtMoney(f.gastos, f.moneda) + '\n' : '') +
      '• Comisión del abogado: ' + fmtMoney(f.comision, f.moneda) + (f.itbisComision ? ' + ITBIS ' + fmtMoney(f.itbisComision, f.moneda) : '') + '\n' +
      '• ' + (f.neto < 0 ? 'Saldo a su cargo: ' : 'Saldo a su favor: ') + fmtMoney(Math.abs(f.neto), f.moneda) + '\n' +
      (f.registro ? (f.registro.montoTransferido < 0 ? 'Cobrado' : 'Transferido') + ' el ' + fmtDate(f.registro.fecha) + '.\n' : '') +
      '\nLe enviamos el detalle en PDF.\n\nAtentamente,\n' + ajuste('firma') + (ajuste('despachoTelefono') ? '\nTel. ' + ajuste('despachoTelefono') : '');
  }

  function renderEnvio(){
    const filas = filasEstados(envioPeriodo);
    $('envioTitulo').textContent = 'Liquidaciones de ' + fmtPeriodo(envioPeriodo);
    const enviados = filas.filter(f => estadoEnviado(f, envioPeriodo)).length;
    $('envioSub').textContent = filas.length ? plural(filas.length, 'liquidación', 'liquidaciones') + ' con movimientos · ' + enviados + ' enviadas' : 'Ningún edificio tiene movimientos este mes.';
    $('envioTodos').disabled = !filas.length;
    $('envioLista').innerHTML = filas.length ? filas.map(f => {
      const p = f.propietario;
      const key = liqKey(f);
      const enviado = estadoEnviado(f, envioPeriodo);
      return '<div class="lote-fila' + (enviado ? ' enviado' : '') + '">' +
        '<div class="lote-main"><strong>' + esc(edificioNombre(f)) + ' · ' + esc(p.nombre) + (f.moneda ? ' · ' + esc(f.moneda) : '') + '</strong><span class="ag-sub">' +
          (f.neto < 0 ? 'A su cargo ' : 'A su favor ') + esc(fmtMoney(Math.abs(f.neto), f.moneda)) + (enviado ? ' · <b class="ok-text">Enviado ✓</b>' : '') + '</span></div>' +
        '<button type="button" class="btn-panel" data-envio="pdf" data-id="' + esc(key) + '">PDF</button>' +
        '<button type="button" class="btn-panel" data-envio="correo" data-id="' + esc(key) + '"' + (p.email ? '' : ' disabled title="Sin correo registrado"') + '>Correo</button>' +
        '<button type="button" class="btn-brass" data-envio="wa" data-id="' + esc(key) + '"' + (whatsappNumber(p.telefono) ? '' : ' disabled title="Sin teléfono registrado"') + '>WhatsApp</button>' +
      '</div>';
    }).join('') : emptyState('Sin movimientos', 'No hay liquidaciones que enviar para ' + fmtPeriodo(envioPeriodo) + '.');
  }

  function abrirEnvio(periodo){
    envioPeriodo = periodo || liqMes.value || monthOf(todayStr());
    renderEnvio();
    envioOverlay.classList.add('show');
  }
  async function marcarEnviado(f){
    if (estadoEnviado(f, envioPeriodo)) return;
    f.propietario.estadosEnviados = (f.propietario.estadosEnviados || []).concat(envioPeriodo + '|' + f.edificioId);
    await persist();
  }
  $('btnEnvioEstados').addEventListener('click', () => abrirEnvio());
  $('envioClose').addEventListener('click', () => { envioOverlay.classList.remove('show'); renderActive(); });
  $('envioTodos').addEventListener('click', () => {
    const filas = filasEstados(envioPeriodo);
    if (!filas.length) return;
    printHtml(filas.map((f, i) => '<div' + (i < filas.length - 1 ? ' style="page-break-after:always;"' : '') + '>' + estadoCuentaHtml(f, envioPeriodo) + '</div>').join(''),
      'Liquidaciones_' + envioPeriodo, true);
  });
  $('envioLista').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-envio]');
    if (!b) return;
    const f = filasEstados(envioPeriodo).find(x => liqKey(x) === b.dataset.id);
    if (!f) return;
    const p = f.propietario;
    if (b.dataset.envio === 'pdf') { printHtml(estadoCuentaHtml(f, envioPeriodo), tituloEstadoCuenta(f, envioPeriodo), true); return; }
    const texto = resumenEstado(f, envioPeriodo);
    if (b.dataset.envio === 'wa') window.open('https://wa.me/' + whatsappNumber(p.telefono) + '?text=' + encodeURIComponent(texto), '_blank');
    else window.open('mailto:' + encodeURIComponent(p.email) + '?subject=' + encodeURIComponent('Liquidación de ' + edificioNombre(f) + ' · ' + fmtPeriodo(envioPeriodo)) + '&body=' + encodeURIComponent(texto), '_blank');
    await marcarEnviado(f);
    renderEnvio();
  });

  // ---------- Mantenimiento: solicitudes de reparación ----------
  // db.reparaciones: { id, edificioId, unidadId|null, fecha, descripcion,
  //   prioridad, estado: pendiente|proceso|resuelta, reportadoPor,
  //   responsable, notas, resueltaEl, costo, gastoId }
  const PRIORIDADES = [
    { value:'baja', label:'Baja' }, { value:'normal', label:'Normal' }, { value:'alta', label:'Alta' }, { value:'urgente', label:'Urgente' }
  ];
  const ESTADOS_REP = { pendiente:'Pendiente', proceso:'En proceso', resuelta:'Resuelta' };
  const mntEstado = $('mntEstado');
  const mntEdificio = $('mntEdificio');
  [mntEstado, mntEdificio].forEach(el => el.addEventListener('input', renderMantenimiento));

  function repLugar(r){
    const b = byId(db.edificios, r.edificioId);
    const u = r.unidadId ? byId(db.unidades, r.unidadId) : null;
    return (b ? b.nombre : '(edificio eliminado)') + ' · ' + (u ? 'Apto. ' + u.identificador : 'Áreas comunes');
  }
  function prioridadBadge(p){
    const key = { urgente:'atrasado', alta:'por-vencer', normal:'proximo', baja:'finalizado' }[p] || 'finalizado';
    return badge(key, (PRIORIDADES.find(x => x.value === p) || {}).label || p);
  }

  function renderMantenimiento(){
    fillBuildingSelect(mntEdificio, 'Todos los edificios');
    const el = $('tableReparaciones');
    if (!db.reparaciones.length) {
      el.innerHTML = emptyState('Sin solicitudes', 'Averías que reportan los inquilinos.',
        '<button type="button" class="btn-brass" data-act="nueva-reparacion">+ Nueva solicitud</button>');
      return;
    }
    const estado = mntEstado.value;
    const orden = { urgente:0, alta:1, normal:2, baja:3 };
    const list = db.reparaciones.filter(r => {
      if (mntEdificio.value && r.edificioId !== mntEdificio.value) return false;
      if (estado === 'abiertas') return r.estado !== 'resuelta';
      return !estado || r.estado === estado;
    }).sort((a, b) => ((a.estado === 'resuelta') - (b.estado === 'resuelta')) || ((orden[a.prioridad] ?? 2) - (orden[b.prioridad] ?? 2)) || (a.fecha || '').localeCompare(b.fecha || ''));
    el.innerHTML = list.length ? '<table class="data-table"><thead><tr><th>Reportada</th><th>Lugar</th><th>Problema</th><th>Prioridad</th><th>Estado</th><th class="num">Costo</th><th></th></tr></thead><tbody>' +
      list.map(r => '<tr><td class="nowrap">' + esc(fmtDate(r.fecha)) + (r.estado !== 'resuelta' ? '<span class="cell-sub">' + esc(cuandoEs(r.fecha)) + '</span>' : '') + '</td>' +
        '<td>' + esc(repLugar(r)) + (r.reportadoPor ? '<span class="cell-sub">Reportó: ' + esc(r.reportadoPor) + '</span>' : '') + '</td>' +
        '<td><span class="cell-main">' + esc(r.descripcion) + '</span>' + (r.responsable ? '<span class="cell-sub">Responsable: ' + esc(r.responsable) + '</span>' : '') + '</td>' +
        '<td>' + prioridadBadge(r.prioridad) + '</td>' +
        '<td>' + badge(r.estado === 'resuelta' ? 'pagado' : r.estado === 'proceso' ? 'parcial' : 'pendiente', ESTADOS_REP[r.estado] || r.estado) +
          (r.resueltaEl ? '<span class="cell-sub">' + esc(fmtDate(r.resueltaEl)) + '</span>' : '') + '</td>' +
        '<td class="num">' + (r.costo ? esc(fmtMoney(r.costo, r.moneda)) + (r.gastoId && byId(db.gastos, r.gastoId) ? '<span class="cell-sub">en Gastos</span>' : '') : '<span class="muted">—</span>') + '</td>' +
        '<td><div class="row-actions">' +
          (r.estado !== 'resuelta' ? '<button type="button" class="btn-brass" data-act="resolver-reparacion" data-id="' + esc(r.id) + '">Resolver…</button>' : '') +
          '<button type="button" class="btn-panel" data-act="editar-reparacion" data-id="' + esc(r.id) + '">Editar</button>' +
          rowMenu([
            r.estado === 'pendiente' && { act:'reparacion-proceso', id:r.id, label:'Marcar "en proceso"' },
            { act:'borrar-reparacion', id:r.id, label:'Eliminar', danger:true }
          ]) + '</div></td></tr>').join('') + '</tbody></table>'
      : emptyState('Sin resultados', 'Ninguna solicitud coincide con los filtros.');
  }

  function openReparacionForm(id, defaults){
    if (!db.edificios.length) { ui.showNotice('Primero registra el edificio.', 'Falta un edificio'); return; }
    const current = id ? byId(db.reparaciones, id) : null;
    const values = current ? Object.assign({}, current) : Object.assign({ fecha: todayStr(), prioridad:'normal', estado:'pendiente' }, defaults);
    if (!values.edificioId && db.edificios.length === 1) values.edificioId = db.edificios[0].id;
    openForm({
      title: current ? 'Editar solicitud' : 'Nueva solicitud de reparación',
      fields: [
        { name:'edificioId', label:'Edificio', type:'select', required:true, options: db.edificios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre)).map(b => ({ value:b.id, label:b.nombre })) },
        { name:'unidadId', label:'¿Dónde?', type:'select', options: unidadOptionsOf(values.edificioId) },
        { name:'descripcion', label:'Problema', required:true, full:true, placeholder:'Ej: Filtración en el baño principal' },
        { name:'fecha', label:'Fecha del reporte', type:'date', required:true },
        { name:'prioridad', label:'Prioridad', type:'select', options:PRIORIDADES },
        { name:'reportadoPor', label:'Reportado por', placeholder:'Inquilino, conserje...' },
        { name:'responsable', label:'Responsable', placeholder:'Técnico o empresa' },
        current && { name:'estado', label:'Estado', type:'select', options:Object.entries(ESTADOS_REP).map(([value, label]) => ({ value, label })) },
        { name:'notas', label:'Notas', type:'textarea', full:true }
      ].filter(Boolean),
      values,
      onInput(form, name){
        if (name !== 'edificioId') return;
        form.querySelector('[name="unidadId"]').innerHTML = unidadOptionsOf(form.querySelector('[name="edificioId"]').value)
          .map(o => '<option value="' + esc(o.value) + '">' + esc(o.label) + '</option>').join('');
      },
      async onSave(v){
        if (!v.unidadId) v.unidadId = null;
        if (current) Object.assign(current, v);
        else db.reparaciones.push(Object.assign({ id: uid('rep'), creado: new Date().toISOString(), estado:'pendiente' }, v));
        return persist();
      }
    });
  }

  function openResolverForm(id){
    const r = byId(db.reparaciones, id);
    if (!r) return;
    openForm({
      title: 'Resolver reparación',
      subtitle: repLugar(r) + ' · ' + r.descripcion,
      fields: [
        { name:'resueltaEl', label:'Fecha', type:'date', required:true },
        { name:'responsable', label:'Quién lo resolvió' },
        { name:'moneda', label:'Moneda', type:'select', options: MONEDAS.map(m => ({ value:m, label:m })) },
        { name:'costo', label:'Costo', type:'number', min:0, step:'0.01' },
        { name:'factura', label:'No. de factura / NCF' },
        { name:'registrarGasto', label:'Registrar el costo en Gastos (categoría Reparación)', type:'checkbox', full:true },
        { name:'notas', label:'Notas', type:'textarea', full:true }
      ],
      values: { resueltaEl: todayStr(), responsable: r.responsable, moneda: ajuste('moneda'), registrarGasto: true, notas: r.notas },
      async onSave(v){
        Object.assign(r, { estado:'resuelta', resueltaEl: v.resueltaEl, responsable: v.responsable, moneda: v.moneda, costo: v.costo || null, notas: v.notas });
        if (v.registrarGasto && v.costo > 0) {
          const g = { id: uid('gst'), creado: new Date().toISOString(), edificioId: r.edificioId, unidadId: r.unidadId || null, categoria:'Reparación',
            fecha: v.resueltaEl, descripcion: r.descripcion, moneda: v.moneda, monto: v.costo, proveedor: v.responsable || '', factura: v.factura || '', notas: 'Solicitud de reparación del ' + fmtDate(r.fecha) + '.' };
          db.gastos.push(g);
          r.gastoId = g.id;
        }
        return persist();
      }
    });
  }

  async function borrarReparacion(id){
    const r = byId(db.reparaciones, id);
    if (!r || !(await ui.showConfirmDialog('¿Eliminar la solicitud "' + r.descripcion + '"?' + (r.gastoId ? ' El gasto registrado se conserva.' : ''), 'Eliminar solicitud'))) return;
    db.reparaciones = db.reparaciones.filter(x => x.id !== id);
    await persist();
    renderActive();
  }

  // ---------- Acta de entrega y de devolución del inmueble ----------
  // db.actas: { id, contratoId, tipo: entrega|devolucion, fecha, items:
  //   [{ id, area, elemento, estado, nota, estadoEntrega }], luz, agua, gas,
  //   llaves, observaciones, fotos: [nombres en el expediente del inquilino] }
  const ESTADOS_ACTA = ['Bueno', 'Regular', 'Malo', 'No tiene'];
  const ITEMS_ACTA = [
    ['Sala y comedor', ['Paredes y pintura', 'Piso', 'Ventanas y cristales', 'Puerta principal y cerradura', 'Bombillos e interruptores']],
    ['Cocina', ['Gabinetes', 'Tope y fregadero', 'Estufa', 'Nevera', 'Grifería']],
    ['Baños', ['Inodoro', 'Lavamanos', 'Ducha y grifería', 'Espejo y accesorios']],
    ['Habitaciones', ['Paredes y pintura', 'Closets', 'Puertas']],
    ['General', ['Aire acondicionado', 'Calentador', 'Inversor / planta', 'Control del portón']]
  ];
  const actaOverlay = $('actaOverlay');
  let actaActual = null;   // copia en edición

  function actaDe(contratoId, tipo){ return db.actas.find(a => a.contratoId === contratoId && a.tipo === tipo) || null; }
  function peorQue(a, b){ const o = { 'Bueno':0, 'Regular':1, 'Malo':2 }; return a in o && b in o && o[a] > o[b]; }

  function openActa(contratoId, tipo){
    const c = byId(db.contratos, contratoId);
    if (!c) return;
    const guardada = actaDe(contratoId, tipo);
    const entrega = actaDe(contratoId, 'entrega');
    actaActual = guardada ? JSON.parse(JSON.stringify(guardada)) : {
      id: null, contratoId, tipo, fecha: tipo === 'entrega' ? (c.fechaInicio || todayStr()) : todayStr(), fotos: [],
      items: tipo === 'devolucion' && entrega
        ? entrega.items.map(i => ({ id: uid('it'), area: i.area, elemento: i.elemento, estadoEntrega: i.estado, estado: '', nota: '' }))
        : ITEMS_ACTA.flatMap(([area, elementos]) => elementos.map(elemento => ({ id: uid('it'), area, elemento, estado: tipo === 'entrega' ? 'Bueno' : '', nota: '' })))
    };
    renderActa();
    actaOverlay.classList.add('show');
  }

  function renderActa(){
    const a = actaActual;
    const c = byId(db.contratos, a.contratoId);
    const devolucion = a.tipo === 'devolucion';
    $('actaTitulo').textContent = devolucion ? 'Acta de devolución del inmueble' : 'Acta de entrega del inmueble';
    $('actaSub').textContent = contractTitle(c) + (a.id ? '' : ' · nueva') + (devolucion && !actaDe(a.contratoId, 'entrega') ? ' · No hay acta de entrega para comparar.' : '');
    $('actaFecha').value = a.fecha || '';
    ['luz', 'agua', 'gas', 'llaves'].forEach(k => { $('acta-' + k).value = a[k] == null ? '' : a[k]; });
    $('actaObs').value = a.observaciones || '';
    $('actaColEntrega').hidden = !devolucion;
    $('actaItems').innerHTML = a.items.map(i =>
      '<tr data-item="' + esc(i.id) + '"' + (devolucion && peorQue(i.estado, i.estadoEntrega) ? ' class="acta-peor"' : '') + '>' +
        '<td><input type="text" data-k="area" value="' + esc(i.area) + '" aria-label="Área"></td>' +
        '<td><input type="text" data-k="elemento" value="' + esc(i.elemento) + '" aria-label="Elemento"></td>' +
        (devolucion ? '<td class="acta-entrega">' + esc(i.estadoEntrega || '—') + '</td>' : '') +
        '<td><select data-k="estado" aria-label="Estado"><option value="">—</option>' + ESTADOS_ACTA.map(e => '<option' + (e === i.estado ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></td>' +
        '<td><input type="text" data-k="nota" value="' + esc(i.nota || '') + '" placeholder="Observación" aria-label="Observación"></td>' +
        '<td><button type="button" class="icon-x" data-acta-quitar="' + esc(i.id) + '" title="Quitar" aria-label="Quitar">✕</button></td></tr>').join('');
    const peores = devolucion ? a.items.filter(i => peorQue(i.estado, i.estadoEntrega)).length : 0;
    $('actaResumen').textContent = devolucion
      ? (peores ? plural(peores, 'elemento está', 'elementos están') + ' en peor estado que al entregar.' : 'Sin desperfectos respecto a la entrega.')
      : plural(a.items.length, 'elemento', 'elementos') + ' en el inventario.';
    $('actaResumen').className = 'mgmt-note' + (peores ? ' warn-text' : '');
    $('actaFotos').innerHTML = (a.fotos || []).length
      ? a.fotos.map(n => '<button type="button" class="link-btn acta-foto" data-acta-foto="' + esc(n) + '">' + esc(n) + '</button>').join('')
      : '<span class="muted">Sin fotos. Se guardan en el expediente del inquilino.</span>';
    $('actaDeposito').hidden = !(devolucion && Number(c.deposito) > 0);
    $('actaBorrar').hidden = !a.id;
  }

  // Pasa lo escrito en la ventana a actaActual.
  function leerActa(){
    const a = actaActual;
    a.fecha = $('actaFecha').value;
    ['luz', 'agua', 'gas'].forEach(k => { a[k] = $('acta-' + k).value.trim(); });
    a.llaves = $('acta-llaves').value === '' ? null : Number($('acta-llaves').value);
    a.observaciones = $('actaObs').value.trim();
    $('actaItems').querySelectorAll('tr[data-item]').forEach(tr => {
      const it = a.items.find(x => x.id === tr.dataset.item);
      if (it) tr.querySelectorAll('[data-k]').forEach(el => { it[el.dataset.k] = el.value.trim(); });
    });
    return a;
  }

  $('actaItems').addEventListener('change', () => { leerActa(); renderActa(); });
  $('actaItems').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acta-quitar]');
    if (!b) return;
    leerActa();
    actaActual.items = actaActual.items.filter(i => i.id !== b.dataset.actaQuitar);
    renderActa();
  });
  $('actaAddItem').addEventListener('click', () => {
    leerActa();
    const ultimo = actaActual.items[actaActual.items.length - 1];
    actaActual.items.push({ id: uid('it'), area: ultimo ? ultimo.area : '', elemento: '', estado: '', nota: '' });
    renderActa();
    const filas = $('actaItems').querySelectorAll('tr');
    filas[filas.length - 1].querySelector('[data-k="elemento"]').focus();
  });
  $('actaFotosAdd').addEventListener('click', async () => {
    const c = byId(db.contratos, actaActual.contratoId);
    const t = c && byId(db.inquilinos, c.inquilinoId);
    if (!t || !window.rcExpediente) return;
    leerActa();
    if (!(await asegurarCarpetaExpediente(t))) return;
    const r = await window.rcExpediente.add(t.expedienteCarpeta);
    if (!r.ok) { await ui.showNotice('No se pudieron adjuntar las fotos: ' + r.error); return; }
    actaActual.fotos = (actaActual.fotos || []).concat(r.added.filter(n => !(actaActual.fotos || []).includes(n)));
    renderActa();
  });
  $('actaFotos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-acta-foto]');
    const c = b && byId(db.contratos, actaActual.contratoId);
    const t = c && byId(db.inquilinos, c.inquilinoId);
    if (t && t.expedienteCarpeta) window.rcExpediente.open(t.expedienteCarpeta, b.dataset.actaFoto);
  });

  async function guardarActa(){
    const a = leerActa();
    if (!a.fecha) { await ui.showNotice('Indica la fecha del acta.'); return false; }
    const nueva = !a.id;
    if (nueva) {
      a.id = uid('act');
      a.creado = new Date().toISOString();
      db.actas.push(JSON.parse(JSON.stringify(a)));
    } else {
      const i = db.actas.findIndex(x => x.id === a.id);
      db.actas[i] = JSON.parse(JSON.stringify(a));
    }
    const c = byId(db.contratos, a.contratoId);
    const t = c && byId(db.inquilinos, c.inquilinoId);
    if (nueva && t) t.seguimiento = (t.seguimiento || []).concat({ id: uid('nota'), fecha: new Date().toISOString(), texto: (a.tipo === 'entrega' ? 'Acta de entrega' : 'Acta de devolución') + ' del ' + fmtDate(a.fecha) + ' registrada.' });
    if (!(await persist())) return false;
    renderActa();
    renderActive();
    return true;
  }

  function actaHtml(a){
    const c = byId(db.contratos, a.contratoId) || {};
    const t = byId(db.inquilinos, c.inquilinoId) || {};
    const u = byId(db.unidades, c.unidadId);
    const p = propietarioDe(u) || {};
    const devolucion = a.tipo === 'devolucion';
    const th = (x) => '<th style="text-align:left;border-bottom:1.5px solid #333;padding:4px 6px;font-size:9.5pt;">' + x + '</th>';
    const td = (x, extra) => '<td style="border-bottom:1px solid #ddd;padding:4px 6px;font-size:10pt;' + (extra || '') + '">' + x + '</td>';
    let area = null;
    const filas = a.items.map(i => {
      const cab = i.area !== area ? '<tr><td colspan="' + (devolucion ? 4 : 3) + '" style="padding:10px 6px 3px;font-weight:bold;">' + esc(i.area) + '</td></tr>' : '';
      area = i.area;
      return cab + '<tr>' + td(esc(i.elemento)) + (devolucion ? td(esc(i.estadoEntrega || '—')) : '') +
        td(esc(i.estado || '—'), peorQue(i.estado, i.estadoEntrega) ? 'font-weight:bold;' : '') + td(esc(i.nota || '')) + '</tr>';
    }).join('');
    const firma = (label, nombre) => '<td style="width:50%;padding:0 18px;text-align:center;vertical-align:bottom;">' +
      '<div style="border-top:1px solid #333;margin-top:56px;padding-top:6px;">' + esc(nombre || '') + '</div><div style="font-size:9.5pt;color:#555;">' + esc(label) + '</div></td>';
    const lect = [['Luz', a.luz], ['Agua', a.agua], ['Gas', a.gas]].filter(x => x[1]).map(x => x[0] + ': ' + esc(x[1])).join(' · ');
    return '<div style="max-width:720px;margin:0 auto;font-size:10.5pt;">' +
      '<div style="text-align:center;font-size:15pt;font-weight:bold;letter-spacing:.04em;">' + (devolucion ? 'ACTA DE DEVOLUCIÓN DEL INMUEBLE' : 'ACTA DE ENTREGA DEL INMUEBLE') + '</div>' +
      '<div style="text-align:center;color:#444;margin-bottom:14px;">' + esc(fmtDateLong(a.fecha)) + '</div>' +
      '<p style="line-height:1.7;">' + (devolucion ? 'El inquilino <b>' + esc(t.nombre || '—') + '</b> devuelve' : 'Se entrega al inquilino <b>' + esc(t.nombre || '—') + '</b>' + (t.documento ? ', documento ' + esc(t.documento) + ',' : '')) +
        ' el inmueble <b>' + esc(unidadLabel(u)) + '</b>' + (p.nombre ? ', propiedad de <b>' + esc(p.nombre) + '</b>,' : '') + ' en el estado que se detalla a continuación.</p>' +
      '<table style="width:100%;border-collapse:collapse;"><tr>' + th('Elemento') + (devolucion ? th('Al entregar') : '') + th(devolucion ? 'Al devolver' : 'Estado') + th('Observación') + '</tr>' + filas + '</table>' +
      (lect || a.llaves != null ? '<p style="margin-top:14px;">' + (lect ? '<b>Lecturas de contadores:</b> ' + lect + '<br>' : '') + (a.llaves != null ? '<b>Llaves entregadas:</b> ' + esc(a.llaves) : '') + '</p>' : '') +
      (a.observaciones ? '<p><b>Observaciones:</b> ' + esc(a.observaciones).replace(/\n/g, '<br>') + '</p>' : '') +
      ((a.fotos || []).length ? '<p style="color:#555;font-size:9.5pt;">Fotos en el expediente: ' + a.fotos.map(esc).join(', ') + '</p>' : '') +
      '<table style="width:100%;border-collapse:collapse;margin-top:24px;"><tr>' + firma('Por el propietario / administración', ajuste('despacho') || p.nombre) + firma('Inquilino', t.nombre) + '</tr></table>' +
    '</div>';
  }

  $('actaGuardar').addEventListener('click', guardarActa);
  $('actaClose').addEventListener('click', () => { actaOverlay.classList.remove('show'); actaActual = null; });
  $('actaImprimir').addEventListener('click', () => {
    const a = leerActa();
    const c = byId(db.contratos, a.contratoId);
    const t = c && byId(db.inquilinos, c.inquilinoId);
    printHtml(actaHtml(a), 'Acta_' + a.tipo + '_' + ((t && t.nombre) || 'inquilino').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '_'));
  });
  $('actaDeposito').addEventListener('click', async () => {
    if (!(await guardarActa())) return;
    const id = actaActual.contratoId;
    actaOverlay.classList.remove('show');
    openDepositoForm(id);
  });
  $('actaBorrar').addEventListener('click', async () => {
    if (!actaActual || !actaActual.id || !(await ui.showConfirmDialog('¿Eliminar esta acta?', 'Eliminar acta'))) return;
    db.actas = db.actas.filter(x => x.id !== actaActual.id);
    actaOverlay.classList.remove('show');
    actaActual = null;
    await persist();
    renderActive();
  });

  // ---------- Recordatorios en lote ----------
  // Todos los inquilinos con atraso en una lista, cada uno con su mensaje
  // listo. "Enviar a todos" manda los correos solo (con la cuenta de
  // Configuración → Correo para recordatorios) y luego guía los WhatsApp
  // uno a uno: WhatsApp no permite envíos automáticos, así que cada chat se
  // abre con el texto y basta pulsar Enter aquí para pasar al siguiente.
  // Todo envío se anota en el seguimiento del inquilino.
  const loteOverlay = $('loteOverlay');
  const loteEnviados = new Map(); // contratoId -> { correo, wa, error } (en esta sesión)
  let loteCola = null;            // WhatsApp guiado: { ids:[contratoId], i }
  let loteOcupado = false;

  function deudoresActuales(){
    return db.contratos.map(c => ({ c, d: deudaDe(c), t: inquilinosDe(c)[0] }))
      .filter(x => x.d.monto > 0 && x.t)
      .sort((a, b) => b.d.meses - a.d.meses || b.d.monto - a.d.monto);
  }
  function estadoLote(id){
    if (!loteEnviados.has(id)) loteEnviados.set(id, {});
    return loteEnviados.get(id);
  }
  function setEstadoLote(html){ $('loteEstado').innerHTML = html; }

  function renderLote(){
    const lista = deudoresActuales();
    const conWa = lista.filter(x => whatsappNumber(x.t.telefono)).length;
    $('loteSub').textContent = plural(lista.length, 'inquilino con pagos atrasados', 'inquilinos con pagos atrasados') + ' · ' +
      conWa + ' con WhatsApp · ' + lista.filter(x => x.t.email).length + ' con correo';
    $('loteTodos').disabled = !lista.length || loteOcupado || !!loteCola;
    const actual = loteCola ? loteCola.ids[loteCola.i] : null;
    $('loteLista').innerHTML = lista.length ? lista.map(({ c, d, t }) => {
      const e = loteEnviados.get(c.id) || {};
      const hechos = [e.correo && 'correo', e.wa && 'WhatsApp'].filter(Boolean);
      return '<div class="lote-fila' + (hechos.length ? ' enviado' : '') + (c.id === actual ? ' actual' : '') + '">' +
        '<div class="lote-main"><strong>' + esc(t.nombre) + '</strong><span class="ag-sub">' + esc(unidadLabel(byId(db.unidades, c.unidadId))) + ' · debe ' + esc(fmtMoney(d.monto, c.moneda)) +
          ' (' + plural(d.meses, 'mes', 'meses') + ')' + (hechos.length ? ' · <b class="ok-text">Enviado por ' + esc(hechos.join(' y ')) + ' ✓</b>' : '') +
          (e.error ? ' · <span class="lote-error">' + esc(e.error) + '</span>' : '') + '</span></div>' +
        '<button type="button" class="btn-panel" data-lote="ver" data-id="' + esc(c.id) + '">Ver mensaje</button>' +
        '<button type="button" class="btn-panel" data-lote="correo" data-id="' + esc(c.id) + '"' + (t.email ? '' : ' disabled title="Sin correo registrado"') + '>Correo</button>' +
        '<button type="button" class="btn-brass" data-lote="wa" data-id="' + esc(c.id) + '"' + (whatsappNumber(t.telefono) ? '' : ' disabled title="Sin teléfono registrado"') + '>WhatsApp</button>' +
      '</div>';
    }).join('') : emptyState('Nadie tiene pagos atrasados', 'No hay recordatorios que enviar.');
    renderGuia();
  }

  function abrirWhatsApp(c, t){
    window.open('https://wa.me/' + whatsappNumber(t.telefono) + '?text=' + encodeURIComponent(textoRecordatorio(c)), '_blank');
    estadoLote(c.id).wa = true;
    registrarSeguimiento(t.id, 'Recordatorio de pago enviado por WhatsApp (envío en lote).');
  }
  function abrirCorreo(c, t){
    window.open('mailto:' + encodeURIComponent(t.email) + '?subject=' + encodeURIComponent('Recordatorio de pago de alquiler') + '&body=' + encodeURIComponent(textoRecordatorio(c)), '_blank');
    estadoLote(c.id).correo = true;
    registrarSeguimiento(t.id, 'Recordatorio de pago enviado por correo (envío en lote).');
  }

  // ---- Enviar a todos ----
  async function enviarATodos(){
    if (loteOcupado || loteCola) return;
    const lista = deudoresActuales();
    const correoListo = !!(window.rcCorreo && (await window.rcCorreo.status()).configured);
    const porCorreo = correoListo ? lista.filter(x => x.t.email && !estadoLote(x.c.id).correo) : [];
    let correosOk = 0, correosFallidos = 0;
    if (porCorreo.length) {
      loteOcupado = true;
      renderLote();
      setEstadoLote('Enviando correos… 0 de ' + porCorreo.length);
      const r = await window.rcCorreo.enviarLote(porCorreo.map(({ c, t }) => ({
        id: c.id, to: t.email, subject: 'Recordatorio de pago de alquiler', text: textoRecordatorio(c)
      })), (p) => {
        const e = estadoLote(p.resultado.id);
        if (p.resultado.ok) { e.correo = true; e.error = null; } else e.error = p.resultado.error;
        setEstadoLote('Enviando correos… ' + p.hecho + ' de ' + p.total);
        renderLote();
      });
      for (const res of (r.resultados || [])) {
        const x = porCorreo.find(y => y.c.id === res.id);
        if (res.ok) { correosOk++; estadoLote(res.id).correo = true; if (x) await registrarSeguimiento(x.t.id, 'Recordatorio de pago enviado por correo automático (envío a todos).'); }
        else correosFallidos++;
      }
      loteOcupado = false;
      if (!r.ok && r.error) {
        setEstadoLote('<span class="lote-error">' + esc(r.error) + '</span>');
        renderLote();
        if (!(r.resultados || []).length) return;
      }
    }
    // WhatsApp guiado: a quien tiene número y no lo recibió aún (y, salvo que
    // se marque la casilla, a quien no recibió el correo).
    const waTambien = $('loteWaTambien').checked;
    const ids = lista.filter(x => whatsappNumber(x.t.telefono) && !estadoLote(x.c.id).wa && (waTambien || !estadoLote(x.c.id).correo)).map(x => x.c.id);
    const resumen = [];
    if (correosOk) resumen.push(plural(correosOk, 'correo enviado', 'correos enviados'));
    if (correosFallidos) resumen.push('<span class="lote-error">' + plural(correosFallidos, 'correo falló', 'correos fallaron') + '</span>');
    const sinCorreo = !correoListo && lista.some(x => x.t.email);
    if (sinCorreo) resumen.push('correo sin configurar: <button type="button" class="link-btn" data-correo-open>Configurar</button>');
    if (ids.length) {
      loteCola = { ids, i: 0, resumen };
      renderLote();
      $('loteGuiaAbrir').focus();
    } else {
      const sinCanal = lista.filter(x => !estadoLote(x.c.id).correo && !estadoLote(x.c.id).wa && !whatsappNumber(x.t.telefono) && !x.t.email).length;
      if (sinCanal) resumen.push(plural(sinCanal, 'inquilino sin teléfono ni correo', 'inquilinos sin teléfono ni correo'));
      setEstadoLote(resumen.length ? resumen.join(' · ') : 'Ya se envió a todos.');
      renderLote();
    }
  }

  function renderGuia(){
    const guia = $('loteGuia');
    if (!loteCola) { guia.hidden = true; return; }
    const c = byId(db.contratos, loteCola.ids[loteCola.i]);
    const t = c && inquilinosDe(c)[0];
    guia.hidden = false;
    $('loteGuiaPaso').textContent = 'WhatsApp ' + (loteCola.i + 1) + ' de ' + loteCola.ids.length;
    $('loteGuiaNombre').textContent = t ? t.nombre + ' · ' + unidadLabel(byId(db.unidades, c.unidadId)) : '—';
    setEstadoLote((loteCola.resumen.length ? loteCola.resumen.join(' · ') + ' · ' : '') + 'Envía el mensaje en WhatsApp y vuelve aquí.');
  }
  function avanzarGuia(abrir){
    if (!loteCola) return;
    const c = byId(db.contratos, loteCola.ids[loteCola.i]);
    const t = c && inquilinosDe(c)[0];
    if (abrir && c && t) abrirWhatsApp(c, t);
    loteCola.i++;
    if (loteCola.i >= loteCola.ids.length) terminarGuia();
    else { renderLote(); $('loteGuiaAbrir').focus(); }
  }
  function terminarGuia(){
    if (!loteCola) return;
    const enviados = loteCola.ids.filter(id => estadoLote(id).wa).length;
    const resumen = loteCola.resumen.concat(plural(enviados, 'WhatsApp abierto', 'WhatsApp abiertos'));
    loteCola = null;
    setEstadoLote('Listo: ' + resumen.join(' · ') + '.');
    renderLote();
  }

  function abrirLote(){
    setEstadoLote('');
    renderLote();
    loteOverlay.classList.add('show');
  }
  $('btnLote').addEventListener('click', abrirLote);
  $('loteClose').addEventListener('click', () => { loteCola = null; loteOverlay.classList.remove('show'); });
  $('loteTodos').addEventListener('click', enviarATodos);
  $('loteGuiaAbrir').addEventListener('click', () => avanzarGuia(true));
  $('loteGuiaSaltar').addEventListener('click', () => avanzarGuia(false));
  $('loteGuiaDetener').addEventListener('click', terminarGuia);
  // Al volver de WhatsApp, Enter abre el siguiente chat.
  window.addEventListener('focus', () => { if (loteCola && loteOverlay.classList.contains('show')) $('loteGuiaAbrir').focus(); });
  $('loteLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lote]');
    if (!b) return;
    const c = byId(db.contratos, b.dataset.id);
    const t = c && inquilinosDe(c)[0];
    if (!t) return;
    if (b.dataset.lote === 'ver') { openRecordatorio(c.id); return; }
    if (b.dataset.lote === 'wa') abrirWhatsApp(c, t);
    else abrirCorreo(c, t);
    renderLote();
  });

  // ---------- Correo para recordatorios (Configuración) ----------
  const correoOverlay = $('correoOverlay');
  const PROVEEDORES_CORREO = { gmail: { host:'smtp.gmail.com', port:465 }, yahoo: { host:'smtp.mail.yahoo.com', port:465 } };

  function proveedorDe(host){ return Object.keys(PROVEEDORES_CORREO).find(k => PROVEEDORES_CORREO[k].host === host) || (host ? 'otro' : 'gmail'); }
  function syncProveedorCorreo(){
    const otro = $('correoProveedor').value === 'otro';
    $('correoServidor').hidden = !otro;
    $('correoAyudaGmail').hidden = $('correoProveedor').value !== 'gmail';
  }
  async function renderCorreo(){
    const st = await window.rcCorreo.status();
    $('correoEstado').textContent = st.configured ? 'Configurado: ' + st.user : 'Sin configurar.';
    $('correoEstado').classList.toggle('ok', st.configured);
    $('correoProveedor').value = proveedorDe(st.host);
    $('correoHost').value = st.host;
    $('correoPuerto').value = st.port || 465;
    $('correoUsuario').value = st.user;
    $('correoNombre').value = st.nombre || ajuste('despacho') || '';
    $('correoPass').value = '';
    $('correoPass').placeholder = st.configured ? 'Guardada (escribe otra para cambiarla)' : 'xxxx xxxx xxxx xxxx';
    $('correoQuitar').hidden = !st.configured;
    $('correoProbar').disabled = !st.configured;
    syncProveedorCorreo();
  }
  async function abrirCorreoConfig(){
    if (!window.rcCorreo) { await ui.showNotice('Disponible solo en la aplicación de escritorio.', 'Correo'); return; }
    $('correoPrueba').textContent = '';
    await renderCorreo();
    correoOverlay.classList.add('show');
    $('correoUsuario').focus();
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-correo-open]')) abrirCorreoConfig(); });
  $('correoProveedor').addEventListener('change', syncProveedorCorreo);
  $('correoCerrar').addEventListener('click', () => { correoOverlay.classList.remove('show'); if (activeView === 'configuracion') renderConfiguracion(); });
  $('correoGmailLink').addEventListener('click', () => window.open('https://myaccount.google.com/apppasswords', '_blank'));
  $('correoGuardar').addEventListener('click', async () => {
    const prov = PROVEEDORES_CORREO[$('correoProveedor').value];
    const r = await window.rcCorreo.set({
      host: prov ? prov.host : $('correoHost').value, port: prov ? prov.port : Number($('correoPuerto').value),
      user: $('correoUsuario').value, pass: $('correoPass').value, nombre: $('correoNombre').value
    });
    if (!r.ok) { $('correoPrueba').innerHTML = '<span class="lote-error">' + esc(r.error) + '</span>'; return; }
    await renderCorreo();
    $('correoPrueba').textContent = 'Guardado. Pulsa "Probar" para enviarte un correo de prueba.';
  });
  $('correoProbar').addEventListener('click', async () => {
    $('correoProbar').disabled = true;
    $('correoPrueba').textContent = 'Enviando correo de prueba…';
    const r = await window.rcCorreo.test();
    $('correoProbar').disabled = false;
    $('correoPrueba').innerHTML = r.ok ? '<span class="ok-text">' + esc(r.mensaje) + '</span>' : '<span class="lote-error">' + esc(r.error) + '</span>';
  });
  $('correoQuitar').addEventListener('click', async () => {
    if (!(await ui.showConfirmDialog('¿Quitar la cuenta de correo? Los recordatorios volverán a abrirse en tu programa de correo.', 'Quitar correo'))) return;
    await window.rcCorreo.remove();
    $('correoPrueba').textContent = '';
    await renderCorreo();
  });

  // ---------- Búsqueda global (Ctrl+K) ----------
  const buscarOverlay = $('buscarOverlay');
  const buscarInput = $('buscarInput');
  const buscarLista = $('buscarResultados');
  let buscarItems = [];
  let buscarSel = 0;

  function resultadosBusqueda(texto){
    const q = normalize(texto).trim();
    if (!q) return [];
    const palabras = q.split(/\s+/);
    const coincide = (...campos) => { const h = normalize(campos.filter(Boolean).join(' ')); return palabras.every(w => h.includes(w)) || (/\d{3,}/.test(q) && claveDocumento(campos.join(' ')).includes(claveDocumento(q))); };
    const out = [];
    db.inquilinos.forEach(t => { if (coincide(t.nombre, t.documento, t.telefono, t.email)) out.push({ tipo:'Inquilino', titulo:t.nombre, sub:[t.documento, t.telefono].filter(Boolean).join(' · '), abrir: () => openTenantDetail(t.id) }); });
    db.propietarios.forEach(p => { if (coincide(p.nombre, p.documento, p.telefono, p.email)) out.push({ tipo:'Propietario', titulo:p.nombre, sub:[p.documento, p.telefono].filter(Boolean).join(' · '), abrir: () => openPropietarioForm(p.id) }); });
    db.edificios.forEach(b => { if (coincide(b.nombre, b.direccion)) out.push({ tipo:'Edificio', titulo:b.nombre, sub:b.direccion || '', abrir: () => ACTIONS['ver-unidades'](b.id) }); });
    db.unidades.forEach(u => {
      if (!coincide(unidadLabel(u), u.tipo)) return;
      const c = activeContractOfUnit(u.id);
      out.push({ tipo:'Apartamento', titulo:unidadLabel(u), sub: c ? 'Alquilado a ' + nombresInquilinos(c) : 'Disponible', abrir: () => ACTIONS.tile(u.id) });
    });
    db.contratos.forEach(c => { if (coincide(contractTitle(c), nombresInquilinos(c))) out.push({ tipo:'Contrato', titulo:contractTitle(c), sub:fmtDate(c.fechaInicio) + ' – ' + fmtDate(c.fechaFin) + ' · ' + contractStatus(c).label, abrir: () => openContratoForm(c.id) }); });
    db.casos.forEach(k => { if (coincide(casoTitulo(k), k.tribunal, k.numeroExpediente)) out.push({ tipo:'Caso', titulo:casoTitulo(k), sub:(casoAbierto(k) ? etapaLabel(k.etapa) : 'Cerrado') + (k.numeroExpediente ? ' · Exp. ' + k.numeroExpediente : ''), abrir: () => openCaso(k.id) }); });
    const n = Number(q.replace(/^no\.?\s*/, ''));
    if (n > 0) {
      const pg = db.pagos.find(x => Number(x.numero) === n);
      if (pg) out.push({ tipo:'Recibo', titulo:'Recibo No. ' + String(n).padStart(5, '0'), sub:fmtDate(pg.fecha) + ' · ' + fmtMoney(pg.monto, pg.moneda), abrir: () => openPagoForm(pg.id) });
    }
    return out.slice(0, 40);
  }

  function renderBusqueda(){
    buscarItems = resultadosBusqueda(buscarInput.value);
    buscarSel = Math.min(buscarSel, Math.max(0, buscarItems.length - 1));
    buscarLista.innerHTML = !buscarInput.value.trim()
      ? '<div class="no-fields">Escribe un nombre, una cédula, un teléfono, un apartamento, un expediente o un número de recibo.</div>'
      : buscarItems.length
        ? buscarItems.map((it, i) => '<button type="button" class="busca-item' + (i === buscarSel ? ' sel' : '') + '" data-i="' + i + '">' +
            '<span class="busca-tipo">' + esc(it.tipo) + '</span><span class="busca-main"><strong>' + esc(it.titulo) + '</strong><span class="ag-sub">' + esc(it.sub) + '</span></span></button>').join('')
        : '<div class="no-fields">Sin resultados para "' + esc(buscarInput.value) + '".</div>';
    const sel = buscarLista.querySelector('.busca-item.sel');
    if (sel) sel.scrollIntoView({ block:'nearest' });
  }
  function abrirBusqueda(){
    if (soloRedactor()) return; // busca en datos de gestión
    buscarInput.value = '';
    buscarSel = 0;
    renderBusqueda();
    buscarOverlay.classList.add('show');
    buscarInput.focus();
  }
  function cerrarBusqueda(){ buscarOverlay.classList.remove('show'); }
  function elegirResultado(i){
    const it = buscarItems[i];
    if (!it) return;
    cerrarBusqueda();
    it.abrir();
  }
  buscarInput.addEventListener('input', () => { buscarSel = 0; renderBusqueda(); });
  buscarInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); buscarSel = Math.min(buscarItems.length - 1, buscarSel + 1); renderBusqueda(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buscarSel = Math.max(0, buscarSel - 1); renderBusqueda(); }
    else if (e.key === 'Enter') { e.preventDefault(); elegirResultado(buscarSel); }
    else if (e.key === 'Escape') cerrarBusqueda();
  });
  buscarLista.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) elegirResultado(Number(b.dataset.i)); });
  buscarOverlay.addEventListener('mousedown', (e) => { if (e.target === buscarOverlay) cerrarBusqueda(); });
  $('btnBuscar').addEventListener('click', abrirBusqueda);
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') {
      if (document.querySelector('.pin-lock:not([hidden])')) return;
      e.preventDefault();
      abrirBusqueda();
    }
  });

  // ---------------------------------------------------------------
  // Casos de cobro y desalojo, y agenda de plazos.
  //
  // Un caso (db.casos) sigue a un contrato con atraso por sus etapas:
  // intimación, demanda, audiencias, sentencia y ejecución. Guarda los
  // datos del proceso (tribunal, expediente, alguacil), una lista de
  // requisitos que se marcan al reunirlos y un historial fechado.
  // La agenda (db.eventos) reúne audiencias, plazos, citas y tareas, más
  // los vencimientos de contratos, que se calculan (no se guardan).
  // ---------------------------------------------------------------
  const TIPOS_CASO = [
    { value:'cobro-desalojo', label:'Cobro de alquileres y desalojo' },
    { value:'cobro', label:'Cobro de alquileres' },
    { value:'desalojo', label:'Desalojo' },
    { value:'otro', label:'Otro' }
  ];
  const ETAPAS_CASO = [
    { key:'intimacion', label:'Intimación de pago' },
    { key:'demanda', label:'Demanda' },
    { key:'audiencia', label:'Audiencias' },
    { key:'sentencia', label:'Sentencia' },
    { key:'ejecucion', label:'Ejecución' }
  ];
  const RESULTADOS_CASO = [
    { value:'pagado', label:'Pagó la deuda' },
    { value:'acuerdo', label:'Acuerdo de pago' },
    { value:'desalojado', label:'Desalojo ejecutado' },
    { value:'entrega', label:'Entregó el inmueble' },
    { value:'desistido', label:'Desistido' },
    { value:'otro', label:'Otro' }
  ];
  // Lista de verificación inicial; cada caso puede añadir o quitar puntos.
  const REQUISITOS_CASO = [
    'Contrato de alquiler firmado',
    'Certificación del depósito del alquiler (Banco Agrícola)',
    'Estado de cuenta de la deuda',
    'Poder o autorización del propietario',
    'Intimación de pago notificada por alguacil'
  ];
  const TIPOS_EVENTO = [
    { value:'audiencia', label:'Audiencia' },
    { value:'plazo', label:'Plazo' },
    { value:'cita', label:'Cita' },
    { value:'tarea', label:'Tarea' },
    { value:'otro', label:'Otro' }
  ];
  const DIAS_SEMANA = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const DIAS_LARGOS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  function etapaLabel(key){ return (ETAPAS_CASO.find(e => e.key === key) || {}).label || key; }
  function tipoCasoLabel(v){ return (TIPOS_CASO.find(t => t.value === v) || {}).label || v; }
  function resultadoLabel(v){ return (RESULTADOS_CASO.find(r => r.value === v) || {}).label || v || ''; }
  function tipoEventoLabel(v){ return (TIPOS_EVENTO.find(t => t.value === v) || {}).label || ({ vencimiento:'Vencimiento', aumento:'Aumento' })[v] || v; }
  function casoAbierto(k){ return k.estado !== 'cerrado'; }
  function casoDeContrato(contratoId){ return db.casos.find(k => k.contratoId === contratoId && casoAbierto(k)) || null; }
  function casoTitulo(k){
    const c = byId(db.contratos, k.contratoId);
    return c ? contractTitle(c) : '(contrato eliminado)';
  }
  function fmtDiaLargo(s){
    const d = parseDate(s);
    return DIAS_LARGOS[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()];
  }
  // "en 3 días", "hoy", "hace 2 días"
  function cuandoEs(fecha){
    const dias = daysBetween(todayStr(), fecha);
    if (dias === 0) return 'hoy';
    if (dias === 1) return 'mañana';
    if (dias === -1) return 'ayer';
    return dias > 0 ? 'en ' + plural(dias, 'día', 'días') : 'hace ' + plural(-dias, 'día', 'días');
  }

  // ---------- Montos en letras (para actos y contratos) ----------
  const UNIDADES_LETRAS = ['', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece',
    'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés',
    'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
  const DECENAS_LETRAS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
  const CENTENAS_LETRAS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
  function menorDeMil(x){
    if (x === 100) return 'cien';
    const r = x % 100;
    const decenas = r < 30 ? UNIDADES_LETRAS[r] : DECENAS_LETRAS[Math.floor(r / 10)] + (r % 10 ? ' y ' + UNIDADES_LETRAS[r % 10] : '');
    return [CENTENAS_LETRAS[Math.floor(x / 100)], decenas].filter(Boolean).join(' ');
  }
  // "uno" se apocopa delante de "mil" y "millones": veintiún mil, un millón.
  function apocope(s){ return s.replace(/veintiuno$/, 'veintiún').replace(/uno$/, 'un'); }
  function numeroEnLetras(n){
    n = Math.floor(Math.abs(Number(n) || 0));
    if (!n) return 'cero';
    const millones = Math.floor(n / 1e6), miles = Math.floor(n % 1e6 / 1000), resto = n % 1000;
    const partes = [];
    if (millones) partes.push(millones === 1 ? 'un millón' : apocope(menorDeMil(millones)) + ' millones');
    if (miles) partes.push(miles === 1 ? 'mil' : apocope(menorDeMil(miles)) + ' mil');
    if (resto) partes.push(menorDeMil(resto));
    return partes.join(' ');
  }
  const NOMBRE_MONEDA = { 'RD$':'pesos dominicanos', 'US$':'dólares estadounidenses', '€':'euros', '$':'pesos' };
  const NOMBRE_MONEDA_UNO = { 'RD$':'peso dominicano', 'US$':'dólar estadounidense', '€':'euro', '$':'peso' };
  // 25000 -> "VEINTICINCO MIL PESOS DOMINICANOS CON 00/100 (RD$ 25,000.00)"
  function montoEnLetras(monto, moneda){
    if (monto == null || isNaN(monto)) return '';
    const entero = Math.floor(Math.abs(monto) + 1e-9);
    const centavos = Math.round((Math.abs(monto) - entero) * 100);
    const deMillon = entero >= 1e6 && entero % 1e6 === 0 ? ' de' : '';
    const nombre = entero === 1 ? (NOMBRE_MONEDA_UNO[moneda] || 'peso') : (NOMBRE_MONEDA[moneda] || 'pesos');
    return (apocope(numeroEnLetras(entero)) + deMillon + ' ' + nombre).toUpperCase() +
      ' CON ' + String(centavos).padStart(2, '0') + '/100 (' + fmtMoney(monto, moneda) + ')';
  }
  function periodosEnTexto(cuotas){
    const meses = cuotas.map(q => fmtPeriodo(q.p));
    return meses.length > 1 ? meses.slice(0, -1).join(', ') + ' y ' + meses[meses.length - 1] : (meses[0] || '');
  }

  // ---------- Vista Casos ----------
  const filterCasosEstado = $('filterCasosEstado');
  const searchCasos = $('searchCasos');
  [filterCasosEstado, searchCasos].forEach(el => el.addEventListener('input', renderCasos));

  function proximoEventoDe(casoId){
    return db.eventos.filter(ev => ev.casoId === casoId && !ev.hecho)
      .sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')))[0] || null;
  }

  function etapasMiniHtml(k){
    const i = ETAPAS_CASO.findIndex(e => e.key === k.etapa);
    return '<div class="caso-mini" title="' + esc(etapaLabel(k.etapa)) + '">' + ETAPAS_CASO.map((e, j) =>
      '<span class="' + (j < i || !casoAbierto(k) ? 'hecha' : j === i ? 'actual' : '') + '"></span>').join('') + '</div>';
  }

  function renderCasos(){
    const el = $('tableCasos');
    if (!db.casos.length) {
      el.innerHTML = emptyState('Sin casos', 'Ábrelo desde un contrato con deuda (menú ⋯) o aquí arriba.',
        '<button type="button" class="btn-brass" data-act="nuevo-caso">+ Nuevo caso</button>');
      return;
    }
    const estado = filterCasosEstado.value;
    const q = normalize(searchCasos.value);
    const list = db.casos.filter(k => {
      if (estado === 'abiertos' && !casoAbierto(k)) return false;
      if (estado === 'cerrados' && casoAbierto(k)) return false;
      return !q || normalize([casoTitulo(k), k.tribunal, k.numeroExpediente].join(' ')).includes(q);
    }).sort((a, b) => (casoAbierto(b) - casoAbierto(a)) || (b.abiertoEl || '').localeCompare(a.abiertoEl || ''));
    if (!list.length) { el.innerHTML = emptyState('Sin resultados', 'Ningún caso coincide con los filtros.'); return; }
    el.innerHTML = '<table class="data-table"><thead><tr><th>Caso</th><th>Etapa</th><th class="num">Deuda actual</th><th>Próxima fecha</th><th>Estado</th><th></th></tr></thead><tbody>' +
      list.map(k => {
        const c = byId(db.contratos, k.contratoId);
        const d = c ? deudaDe(c) : { monto:0, meses:0 };
        const ev = proximoEventoDe(k.id);
        return '<tr><td><button type="button" class="link-btn" data-act="ver-caso" data-id="' + esc(k.id) + '">' + esc(casoTitulo(k)) + '</button>' +
            '<span class="cell-sub">' + esc(tipoCasoLabel(k.tipo)) + (k.numeroExpediente ? ' · Exp. ' + esc(k.numeroExpediente) : '') + '</span></td>' +
          '<td>' + etapasMiniHtml(k) + '<span class="cell-sub">' + esc(casoAbierto(k) ? etapaLabel(k.etapa) : resultadoLabel(k.resultado)) + '</span></td>' +
          '<td class="num">' + (c ? esc(fmtMoney(d.monto, c.moneda)) + '<span class="cell-sub">' + (d.meses ? plural(d.meses, 'mes', 'meses') : 'Al día') + '</span>' : '—') + '</td>' +
          '<td>' + (ev ? '<span class="cell-main">' + esc(fmtDate(ev.fecha)) + (ev.hora ? ' · ' + esc(ev.hora) : '') + '</span><span class="cell-sub">' + esc(tipoEventoLabel(ev.tipo)) + ': ' + esc(ev.titulo) + '</span>' : '<span class="muted">—</span>') + '</td>' +
          '<td>' + (casoAbierto(k) ? badge('proximo', 'Abierto') : badge('finalizado', 'Cerrado')) + '</td>' +
          '<td><div class="row-actions"><button type="button" class="btn-panel" data-act="ver-caso" data-id="' + esc(k.id) + '">Abrir</button></div></td></tr>';
      }).join('') + '</tbody></table>';
  }

  // ---------- Formulario del caso ----------
  function casoFields(current){
    const contratos = db.contratos.slice().sort((a, b) => (isActive(b) - isActive(a)) || (deudaDe(b).monto - deudaDe(a).monto));
    return [
      { name:'contratoId', label:'Contrato', type:'select', required:true, full:true,
        options: contratos.map(c => {
          const d = deudaDe(c);
          return { value:c.id, label:contractTitle(c) + (d.monto > 0 ? ' — debe ' + fmtMoney(d.monto, c.moneda) : '') + (isActive(c) ? '' : ' (finalizado)') };
        }) },
      { name:'tipo', label:'Tipo de caso', type:'select', options:TIPOS_CASO },
      { name:'abiertoEl', label:'Fecha de apertura', type:'date', required:true },
      { name:'tribunal', label:'Tribunal', placeholder:'Ej: Juzgado de Paz de la 1ra. Circunscripción del D.N.' , full:true },
      { name:'numeroExpediente', label:'Número de expediente' },
      { name:'alguacil', label:'Alguacil', placeholder:'Nombre del ministerial' },
      { name:'notas', label:'Notas', type:'textarea', full:true }
    ];
  }

  function openCasoForm(id, defaults){
    if (!db.contratos.length) { ui.showNotice('Para abrir un caso primero tiene que existir el contrato del inquilino.', 'Sin contratos'); return; }
    const current = id ? byId(db.casos, id) : null;
    openForm({
      title: current ? 'Editar caso' : 'Nuevo caso de cobro',
      subtitle: current ? casoTitulo(current) : 'Sigue el proceso de cobro o desalojo de un contrato con atraso.',
      fields: casoFields(current),
      values: current || Object.assign({ tipo:'cobro-desalojo', abiertoEl: todayStr() }, defaults),
      async onSave(values){
        const c = byId(db.contratos, values.contratoId);
        if (!c) return 'Elige el contrato.';
        const otro = casoDeContrato(values.contratoId);
        if (otro && (!current || otro.id !== current.id)) return 'Ese contrato ya tiene un caso abierto. Ábrelo desde la lista de casos.';
        if (current) {
          Object.assign(current, values);
          return persist();
        }
        const d = deudaDe(c);
        const nuevo = Object.assign({
          id: uid('cas'), creado: new Date().toISOString(), estado:'abierto', etapa:'intimacion',
          deudaInicial: d.monto, moneda: c.moneda, mesesIniciales: d.meses,
          requisitos: REQUISITOS_CASO.map(texto => ({ id: uid('req'), texto, hecho:false })),
          historial: [{ id: uid('his'), fecha: values.abiertoEl, texto: 'Caso abierto. Deuda: ' + fmtMoney(d.monto, c.moneda) + (d.meses ? ' (' + plural(d.meses, 'mes', 'meses') + ' desde ' + fmtPeriodo(d.primerPeriodo) + ')' : '') + '.' }]
        }, values);
        db.casos.push(nuevo);
        const ok = await persist();
        if (ok) openCaso(nuevo.id); // la ficha queda debajo del formulario, que se cierra al volver
        return ok;
      }
    });
  }

  // ---------- Ficha del caso ----------
  const casoOverlay = $('casoOverlay');
  const casoBody = $('casoBody');
  let casoId = null;

  function openCaso(id){
    casoId = id;
    closeTenantDetail();
    renderCasoDetalle();
    casoOverlay.classList.add('show');
  }
  function closeCaso(){
    casoId = null;
    casoOverlay.classList.remove('show');
  }

  function renderCasoDetalle(){
    const k = byId(db.casos, casoId);
    if (!k) { closeCaso(); return; }
    const c = byId(db.contratos, k.contratoId);
    const d = c ? deudaDe(c) : null;
    const abierto = casoAbierto(k);
    const iEtapa = ETAPAS_CASO.findIndex(e => e.key === k.etapa);
    const reqs = k.requisitos || [];
    const hechos = reqs.filter(r => r.hecho).length;
    const eventos = db.eventos.filter(ev => ev.casoId === k.id).sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
    const historial = (k.historial || []).slice().sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || (b.id > a.id ? 1 : -1));
    const info = [
      ['Tipo', tipoCasoLabel(k.tipo)], ['Abierto el', fmtDate(k.abiertoEl)],
      ['Tribunal', k.tribunal], ['Expediente', k.numeroExpediente], ['Alguacil', k.alguacil],
      ['Deuda al abrir', k.deudaInicial != null ? fmtMoney(k.deudaInicial, k.moneda) + (k.mesesIniciales ? ' (' + plural(k.mesesIniciales, 'mes', 'meses') + ')' : '') : ''],
      ['Deuda actual', d ? fmtMoney(d.monto, c.moneda) + (d.meses ? ' (' + plural(d.meses, 'mes', 'meses') + ')' : ' · al día') : ''],
      ['Notas', k.notas, true]
    ];
    casoBody.innerHTML =
      '<div class="detail-head"><div><h3>' + esc(casoTitulo(k)) + '</h3><div class="modal-sub">' + esc(tipoCasoLabel(k.tipo)) +
        (abierto ? '' : ' · Cerrado el ' + esc(fmtDate(k.cerradoEl)) + ': ' + esc(resultadoLabel(k.resultado))) + '</div></div>' +
        (abierto ? badge('proximo', 'Abierto') : badge('finalizado', 'Cerrado')) + '</div>' +
      '<ol class="caso-etapas' + (abierto ? '' : ' cerrado') + '">' + ETAPAS_CASO.map((e, j) =>
        '<li class="' + (j < iEtapa || !abierto ? 'hecha' : j === iEtapa ? 'actual' : '') + '">' +
          '<button type="button" data-act="caso-etapa" data-id="' + esc(e.key) + '"' + (abierto && j !== iEtapa ? '' : ' disabled') + ' title="' + (j === iEtapa ? 'Etapa actual' : 'Pasar a esta etapa') + '">' +
          '<span class="paso">' + (j < iEtapa || !abierto ? '✓' : j + 1) + '</span>' + esc(e.label) + '</button></li>').join('') + '</ol>' +
      '<div class="caso-grid">' +
        '<section>' +
          '<dl class="detail-grid caso-datos">' + info.map(([label, value, full]) =>
            '<div' + (full ? ' class="full"' : '') + '><dt>' + esc(label) + '</dt><dd>' + (value ? esc(value).replace(/\n/g, '<br>') : '—') + '</dd></div>').join('') + '</dl>' +
          '<h4 class="detail-section-title">Requisitos <span class="seg-count">' + hechos + '/' + reqs.length + '</span></h4>' +
          '<ul class="caso-reqs">' + reqs.map(r =>
            '<li class="' + (r.hecho ? 'hecho' : '') + '"><label><input type="checkbox" data-act="caso-req" data-id="' + esc(r.id) + '"' + (r.hecho ? ' checked' : '') + '> <span>' + esc(r.texto) + '</span></label>' +
            '<button type="button" class="icon-x" data-act="caso-req-quitar" data-id="' + esc(r.id) + '" title="Quitar de la lista" aria-label="Quitar de la lista">✕</button></li>').join('') + '</ul>' +
          '<div class="note-add caso-req-add"><input type="text" id="casoReqTexto" placeholder="Añadir otro requisito..."><button type="button" class="btn-panel" data-act="caso-req-agregar">Añadir</button></div>' +
        '</section>' +
        '<section>' +
          '<div class="caso-sec-head"><h4 class="detail-section-title">Fechas</h4><button type="button" class="link-btn" data-act="caso-agendar">+ Agendar</button></div>' +
          (eventos.length ? '<div class="ag-list">' + eventos.map(ev => eventoItemHtml(ev, { sinCaso:true })).join('') + '</div>' : '<div class="no-fields">Sin audiencias ni plazos agendados.</div>') +
          '<h4 class="detail-section-title" style="margin-top:18px;">Historial</h4>' +
          '<div class="note-add"><textarea id="casoNotaTexto" rows="2" placeholder="Actuación, llamada, acuerdo..."></textarea><button type="button" class="btn-brass" data-act="caso-nota">Añadir</button></div>' +
          '<ul class="note-list">' + historial.map(h => '<li><div><span class="note-date">' + esc(fmtDate(h.fecha)) + (h.etapa ? ' · ' + esc(etapaLabel(h.etapa)) : '') + '</span>' +
            '<p>' + esc(h.texto).replace(/\n/g, '<br>') + '</p></div>' +
            '<button type="button" class="icon-x" data-act="caso-nota-borrar" data-id="' + esc(h.id) + '" title="Eliminar del historial" aria-label="Eliminar del historial">✕</button></li>').join('') + '</ul>' +
        '</section>' +
      '</div>';
    $('casoCerrar').textContent = abierto ? 'Cerrar caso…' : 'Reabrir caso';
    $('casoRedactar').disabled = !c;
  }

  async function guardarCaso(){
    if (await persist()) { renderCasoDetalle(); renderActive(); }
  }

  function anotarCaso(k, texto, fecha, etapa){
    k.historial = (k.historial || []).concat({ id: uid('his'), fecha: fecha || todayStr(), texto, etapa: etapa || null });
  }

  // Pasar a otra etapa: se anota en el historial y, si se indica, se agenda
  // la próxima fecha (audiencia, plazo...).
  function avanzarEtapa(etapa){
    const k = byId(db.casos, casoId);
    if (!k) return;
    const proxTipo = etapa === 'audiencia' || etapa === 'demanda' ? 'audiencia' : 'plazo';
    openForm({
      title: 'Pasar a: ' + etapaLabel(etapa),
      subtitle: casoTitulo(k),
      fields: [
        { name:'fecha', label:'Fecha', type:'date', required:true },
        { name:'nota', label:'Detalle', type:'textarea', full:true, placeholder: etapa === 'intimacion' ? 'Acto núm..., notificado por...' : etapa === 'demanda' ? 'Demanda depositada en...' : 'Qué ocurrió' },
        { name:'_prox', type:'heading', label:'Próxima fecha', help:'Opcional.' },
        { name:'proxFecha', label:'Fecha', type:'date' },
        { name:'proxHora', label:'Hora', type:'time' },
        { name:'proxTipo', label:'Tipo', type:'select', options:TIPOS_EVENTO },
        { name:'proxTitulo', label:'Descripción', placeholder: proxTipo === 'audiencia' ? 'Audiencia de conocimiento' : 'Vence el plazo de...' }
      ],
      values: { fecha: todayStr(), proxTipo },
      async onSave(v){
        k.etapa = etapa;
        anotarCaso(k, 'Etapa: ' + etapaLabel(etapa) + '.' + (v.nota ? ' ' + v.nota : ''), v.fecha, etapa);
        if (v.proxFecha) {
          db.eventos.push({ id: uid('evt'), creado: new Date().toISOString(), fecha: v.proxFecha, hora: v.proxHora || '', tipo: v.proxTipo,
            titulo: v.proxTitulo || tipoEventoLabel(v.proxTipo), casoId: k.id, hecho:false });
        }
        const ok = await persist();
        if (ok) renderCasoDetalle();
        return ok;
      }
    });
  }

  async function cerrarOReabrirCaso(){
    const k = byId(db.casos, casoId);
    if (!k) return;
    if (!casoAbierto(k)) {
      const otro = casoDeContrato(k.contratoId);
      if (otro) { await ui.showNotice('Ese contrato ya tiene otro caso abierto.', 'No se puede reabrir'); return; }
      k.estado = 'abierto';
      k.cerradoEl = null;
      anotarCaso(k, 'Caso reabierto.');
      return guardarCaso();
    }
    const c = byId(db.contratos, k.contratoId);
    openForm({
      title: 'Cerrar caso',
      subtitle: casoTitulo(k),
      fields: [
        { name:'resultado', label:'Resultado', type:'select', required:true, options:RESULTADOS_CASO },
        { name:'cerradoEl', label:'Fecha', type:'date', required:true },
        { name:'nota', label:'Detalle', type:'textarea', full:true },
        c && isActive(c) && { name:'finalizarContrato', label:'Finalizar también el contrato (el apartamento queda disponible)', type:'checkbox', full:true }
      ].filter(Boolean),
      values: { cerradoEl: todayStr(), resultado: c && deudaDe(c).monto === 0 ? 'pagado' : '' },
      async onSave(v){
        k.estado = 'cerrado';
        k.resultado = v.resultado;
        k.cerradoEl = v.cerradoEl;
        anotarCaso(k, 'Caso cerrado: ' + resultadoLabel(v.resultado) + '.' + (v.nota ? ' ' + v.nota : ''), v.cerradoEl);
        // Las fechas pendientes del caso ya no hacen falta.
        db.eventos.forEach(ev => { if (ev.casoId === k.id && !ev.hecho && ev.fecha >= v.cerradoEl) ev.hecho = true; });
        if (v.finalizarContrato && c) {
          c.estado = 'finalizado';
          c.fechaFinalizacion = v.cerradoEl;
        }
        const ok = await persist();
        if (ok) renderCasoDetalle();
        return ok;
      }
    });
  }

  async function borrarCaso(){
    const k = byId(db.casos, casoId);
    if (!k) return;
    const n = db.eventos.filter(ev => ev.casoId === k.id).length;
    if (!(await ui.showConfirmDialog('¿Eliminar el caso de ' + casoTitulo(k) + ' con todo su historial' + (n ? ' y ' + plural(n, 'fecha', 'fechas') + ' de la agenda' : '') + '? Si ya terminó, es mejor cerrarlo para conservarlo.', 'Eliminar caso'))) return;
    db.casos = db.casos.filter(x => x.id !== k.id);
    db.eventos = db.eventos.filter(ev => ev.casoId !== k.id);
    closeCaso();
    await persist();
    renderActive();
  }

  const ACCIONES_CASO = {
    'caso-etapa': avanzarEtapa,
    'caso-req': async (id) => {
      const k = byId(db.casos, casoId);
      const r = k && (k.requisitos || []).find(x => x.id === id);
      if (!r) return;
      r.hecho = !r.hecho;
      guardarCaso();
    },
    'caso-req-quitar': async (id) => {
      const k = byId(db.casos, casoId);
      if (!k) return;
      k.requisitos = (k.requisitos || []).filter(x => x.id !== id);
      guardarCaso();
    },
    'caso-req-agregar': () => {
      const k = byId(db.casos, casoId);
      const texto = $('casoReqTexto').value.trim();
      if (!k || !texto) return;
      k.requisitos = (k.requisitos || []).concat({ id: uid('req'), texto, hecho:false });
      guardarCaso();
    },
    'caso-nota': () => {
      const k = byId(db.casos, casoId);
      const texto = $('casoNotaTexto').value.trim();
      if (!k || !texto) return;
      anotarCaso(k, texto);
      guardarCaso();
    },
    'caso-nota-borrar': async (id) => {
      const k = byId(db.casos, casoId);
      if (!k || !(await ui.showConfirmDialog('¿Eliminar esta anotación del historial?', 'Eliminar anotación'))) return;
      k.historial = (k.historial || []).filter(h => h.id !== id);
      guardarCaso();
    },
    'caso-agendar': () => openEventoForm(null, { casoId }),
    'evento-hecho': toggleEventoHecho,
    'editar-evento': (id) => openEventoForm(id),
    'borrar-evento': borrarEvento,
    'editar-contrato': (id) => { closeCaso(); openContratoForm(id); }
  };
  bindActions(casoBody, ACCIONES_CASO);
  $('casoClose').addEventListener('click', closeCaso);
  $('casoEditar').addEventListener('click', () => openCasoForm(casoId));
  $('casoCerrar').addEventListener('click', cerrarOReabrirCaso);
  $('casoBorrar').addEventListener('click', borrarCaso);
  $('casoRedactar').addEventListener('click', () => {
    const k = byId(db.casos, casoId);
    const c = k && byId(db.contratos, k.contratoId);
    if (c) openTemplatePicker(c, k);
  });

  // ---------- Agenda ----------
  const agendaMesLabel = $('agendaMesLabel');
  let agendaMes = monthOf(todayStr());
  let agendaDia = null;   // día elegido en el calendario (o null: lista de pendientes)

  // Eventos guardados más los vencimientos de contratos activos entre dos fechas.
  function itemsAgenda(desde, hasta){
    const guardados = db.eventos.filter(ev => ev.fecha >= desde && ev.fecha <= hasta);
    const vencimientos = db.contratos.filter(c => isActive(c) && c.fechaFin && c.fechaFin >= desde && c.fechaFin <= hasta && !c.renovadoA)
      .map(c => ({ id: 'vence-' + c.id, auto:true, fecha: c.fechaFin, tipo:'vencimiento', titulo: 'Vence el contrato de ' + contractTitle(c), contratoId: c.id }));
    const aumentos = db.contratos.map(c => ({ c, a: proximoAumento(c) })).filter(x => x.a && x.a.periodo + '-01' >= desde && x.a.periodo + '-01' <= hasta)
      .map(({ c, a }) => ({ id: 'aumento-' + c.id, auto:true, fecha: a.periodo + '-01', tipo:'aumento', titulo: 'Aumento del alquiler de ' + contractTitle(c), contratoId: c.id }));
    return guardados.concat(vencimientos, aumentos).sort((a, b) => (a.fecha + (a.hora || '')).localeCompare(b.fecha + (b.hora || '')));
  }
  // Lo que requiere atención: lo atrasado sin hacer y lo de hoy.
  function pendientesHoy(){
    const hoy = todayStr();
    return db.eventos.filter(ev => !ev.hecho && ev.fecha <= hoy);
  }

  function eventoItemHtml(ev, opts){
    const o = opts || {};
    const atrasado = !ev.auto && !ev.hecho && ev.fecha < todayStr();
    const k = ev.casoId ? byId(db.casos, ev.casoId) : null;
    return '<div class="ag-item ag-' + esc(ev.tipo) + (ev.hecho ? ' hecho' : '') + (atrasado ? ' atrasado' : '') + '">' +
      (ev.auto
        ? '<span class="ag-check auto" aria-hidden="true">⏳</span>'
        : '<input type="checkbox" class="ag-check" data-act="evento-hecho" data-id="' + esc(ev.id) + '"' + (ev.hecho ? ' checked' : '') + ' title="Marcar como hecho" aria-label="Marcar como hecho">') +
      '<div class="ag-main"><strong>' + esc(ev.titulo) + '</strong>' +
        '<span class="ag-sub">' + (o.conFecha ? esc(fmtDate(ev.fecha)) + ' · ' : '') + (ev.hora ? esc(ev.hora) + ' · ' : '') + esc(tipoEventoLabel(ev.tipo)) +
        (atrasado ? ' · <b class="ag-tarde">' + esc(cuandoEs(ev.fecha)) + '</b>' : '') +
        (ev.lugar ? ' · ' + esc(ev.lugar) : '') + '</span>' +
        (k && !o.sinCaso ? '<button type="button" class="link-btn ag-caso" data-act="ver-caso" data-id="' + esc(k.id) + '">Caso: ' + esc(casoTitulo(k)) + '</button>' : '') +
      '</div>' +
      (ev.auto
        ? (ev.tipo === 'aumento'
          ? '<button type="button" class="btn-panel" data-act="aumento" data-id="' + esc(ev.contratoId) + '">Aplicar</button>'
          : '<button type="button" class="btn-panel" data-act="editar-contrato" data-id="' + esc(ev.contratoId) + '">Ver contrato</button>')
        : rowMenu([{ act:'editar-evento', id:ev.id, label:'Editar' }, { act:'borrar-evento', id:ev.id, label:'Eliminar', danger:true }])) +
    '</div>';
  }

  function renderAgenda(){
    const hoy = todayStr();
    const [y, m] = agendaMes.split('-').map(Number);
    agendaMesLabel.textContent = MESES[m - 1].charAt(0).toUpperCase() + MESES[m - 1].slice(1) + ' ' + y;
    // Calendario: semanas de lunes a domingo que cubren el mes.
    const primero = new Date(y, m - 1, 1);
    const inicio = addDays(agendaMes + '-01', -((primero.getDay() + 6) % 7));
    const finMes = toDateStr(new Date(y, m, 0));
    const fin = addDays(finMes, (7 - parseDate(finMes).getDay()) % 7);
    const items = itemsAgenda(inicio, fin);
    const porDia = new Map();
    items.forEach(it => { if (!porDia.has(it.fecha)) porDia.set(it.fecha, []); porDia.get(it.fecha).push(it); });
    let celdas = '';
    for (let d = inicio; d <= fin; d = addDays(d, 1)) {
      const lista = porDia.get(d) || [];
      const pend = lista.filter(it => !it.hecho);
      celdas += '<button type="button" class="ag-dia' + (monthOf(d) !== agendaMes ? ' fuera' : '') + (d === hoy ? ' hoy' : '') + (d === agendaDia ? ' elegido' : '') +
        (pend.some(it => !it.auto && it.fecha < hoy) ? ' con-atraso' : '') + '" data-dia="' + d + '" title="' + esc(fmtDiaLargo(d) + (lista.length ? ': ' + plural(lista.length, 'evento', 'eventos') : '')) + '">' +
        '<span class="ag-num">' + parseDate(d).getDate() + '</span>' +
        '<span class="ag-puntos">' + lista.slice(0, 4).map(it => '<i class="ag-' + esc(it.tipo) + (it.hecho ? ' hecho' : '') + '"></i>').join('') + '</span>' +
        (lista.length ? '<span class="ag-txt">' + esc(lista[0].titulo) + (lista.length > 1 ? ' +' + (lista.length - 1) : '') + '</span>' : '') +
      '</button>';
    }
    $('agendaCal').innerHTML = DIAS_SEMANA.map(dn => '<span class="ag-dn">' + dn + '</span>').join('') + celdas;

    // Lista: el día elegido, o lo pendiente agrupado por cercanía.
    const lista = $('agendaLista');
    if (agendaDia) {
      const delDia = itemsAgenda(agendaDia, agendaDia);
      lista.innerHTML = '<div class="ag-head"><h3>' + esc(fmtDiaLargo(agendaDia).replace(/^./, ch => ch.toUpperCase())) + '</h3>' +
          '<button type="button" class="link-btn" data-act="agenda-todo">Ver pendientes</button></div>' +
        (delDia.length ? '<div class="ag-list">' + delDia.map(ev => eventoItemHtml(ev)).join('') + '</div>' : '<div class="no-fields">Nada agendado este día.</div>') +
        '<button type="button" class="btn-panel ag-nuevo-dia" data-act="nuevo-evento-dia" data-id="' + agendaDia + '">+ Evento este día</button>';
      return;
    }
    const grupos = [
      ['Atrasado', db.eventos.filter(ev => !ev.hecho && ev.fecha < hoy).sort((a, b) => a.fecha.localeCompare(b.fecha))],
      ['Hoy', itemsAgenda(hoy, hoy).filter(ev => !ev.hecho)],
      ['Próximos 7 días', itemsAgenda(addDays(hoy, 1), addDays(hoy, 7)).filter(ev => !ev.hecho)],
      ['Más adelante (30 días)', itemsAgenda(addDays(hoy, 8), addDays(hoy, 30)).filter(ev => !ev.hecho)]
    ].filter(([, l]) => l.length);
    lista.innerHTML = '<div class="ag-head"><h3>Pendientes</h3></div>' + (grupos.length
      ? grupos.map(([titulo, l]) => '<div class="ag-grupo' + (titulo === 'Atrasado' ? ' ag-grupo-tarde' : '') + '"><div class="pick-group-label">' + esc(titulo) + ' <span class="seg-count">' + l.length + '</span></div>' +
          '<div class="ag-list">' + l.map(ev => eventoItemHtml(ev, { conFecha: titulo !== 'Hoy' })).join('') + '</div></div>').join('')
      : emptyState('Nada pendiente', 'No hay audiencias, plazos ni vencimientos en los próximos 30 días.'));
  }

  $('agendaCal').addEventListener('click', (e) => {
    const b = e.target.closest('[data-dia]');
    if (!b) return;
    agendaDia = agendaDia === b.dataset.dia ? null : b.dataset.dia;
    if (monthOf(b.dataset.dia) !== agendaMes) agendaMes = monthOf(b.dataset.dia);
    renderAgenda();
  });
  $('agendaPrev').addEventListener('click', () => { agendaMes = addMonthsP(agendaMes, -1); renderAgenda(); });
  $('agendaNext').addEventListener('click', () => { agendaMes = addMonthsP(agendaMes, 1); renderAgenda(); });
  $('agendaHoy').addEventListener('click', () => { agendaMes = monthOf(todayStr()); agendaDia = null; renderAgenda(); });

  function openEventoForm(id, defaults){
    const current = id ? byId(db.eventos, id) : null;
    const casos = db.casos.filter(k => casoAbierto(k) || (current && current.casoId === k.id));
    openForm({
      title: current ? 'Editar evento' : 'Nuevo evento',
      fields: [
        { name:'titulo', label:'Descripción', required:true, full:true, placeholder:'Ej: Audiencia de conocimiento' },
        { name:'tipo', label:'Tipo', type:'select', options:TIPOS_EVENTO },
        { name:'fecha', label:'Fecha', type:'date', required:true },
        { name:'hora', label:'Hora', type:'time' },
        { name:'lugar', label:'Lugar', placeholder:'Tribunal, oficina...' },
        { name:'casoId', label:'Caso', type:'select', full:true, options:[{ value:'', label:'Ninguno' }].concat(casos.map(k => ({ value:k.id, label:casoTitulo(k) }))) },
        { name:'notas', label:'Notas', type:'textarea', full:true }
      ],
      values: current || Object.assign({ tipo:'audiencia', fecha: agendaDia || todayStr(), casoId:'' }, defaults),
      async onSave(v){
        if (current) Object.assign(current, v);
        else db.eventos.push(Object.assign({ id: uid('evt'), creado: new Date().toISOString(), hecho:false }, v));
        const k = v.casoId && !current ? byId(db.casos, v.casoId) : null;
        if (k) anotarCaso(k, 'Agendado para el ' + fmtDate(v.fecha) + (v.hora ? ' a las ' + v.hora : '') + ': ' + v.titulo + '.');
        const ok = await persist();
        if (ok && casoId) renderCasoDetalle();
        return ok;
      }
    });
  }

  async function toggleEventoHecho(id){
    const ev = byId(db.eventos, id);
    if (!ev) return;
    ev.hecho = !ev.hecho;
    if (await persist()) { renderActive(); if (casoId) renderCasoDetalle(); }
  }

  async function borrarEvento(id){
    const ev = byId(db.eventos, id);
    if (!ev || !(await ui.showConfirmDialog('¿Eliminar "' + ev.titulo + '" de la agenda?', 'Eliminar evento'))) return;
    db.eventos = db.eventos.filter(x => x.id !== id);
    if (await persist()) { renderActive(); if (casoId) renderCasoDetalle(); }
  }

  // Aviso de Windows una vez al día si hay algo para hoy o atrasado.
  function avisarAgenda(){
    const pend = pendientesHoy();
    if (!pend.length || typeof Notification === 'undefined') return;
    const KEY = 'renthouse.agendaAvisada';
    try { if (localStorage.getItem(KEY) === todayStr()) return; localStorage.setItem(KEY, todayStr()); } catch (err) { return; }
    const hoy = pend.filter(ev => ev.fecha === todayStr());
    const n = new Notification('RentHouse · Agenda', {
      body: (hoy.length ? 'Hoy: ' + hoy.map(ev => (ev.hora ? ev.hora + ' ' : '') + ev.titulo).join(' · ') : '') +
        (pend.length > hoy.length ? (hoy.length ? '\n' : '') + plural(pend.length - hoy.length, 'pendiente atrasado', 'pendientes atrasados') : ''),
      silent: false
    });
    n.onclick = () => { window.focus(); showView('agenda'); };
  }

  // ---------------------------------------------------------------
  // Configuración. Los campos con data-ajuste se guardan en db.ajustes al
  // cambiar; el tema y el menú son preferencias de este equipo
  // (localStorage), y las integraciones y el PIN abren sus propias ventanas.
  // ---------------------------------------------------------------
  const cfgView = document.querySelector('.view[data-view="configuracion"]');
  let cfgGuardadoTimer = null;

  function mostrarGuardado(texto){
    const el = $('cfgGuardado');
    el.textContent = texto || '✓ Guardado';
    el.classList.add('visible');
    clearTimeout(cfgGuardadoTimer);
    cfgGuardadoTimer = setTimeout(() => el.classList.remove('visible'), 1600);
  }

  async function renderConfiguracion(){
    cfgView.querySelectorAll('[data-ajuste]').forEach(el => {
      const v = ajuste(el.dataset.ajuste);
      el.value = v === null || v === undefined ? '' : String(v);
      if (el.dataset.ajuste === 'firma' && el.value === AJUSTES_PREDETERMINADOS.firma) el.value = '';
    });
    const recortado = document.documentElement.classList.contains('nav-collapsed');
    cfgView.querySelectorAll('[data-cfg-menu]').forEach(b => b.classList.toggle('active', (b.dataset.cfgMenu === 'recortado') === recortado));
    renderApariencia();
    const edificios = db.edificios.slice().sort((a, b) => a.nombre.localeCompare(b.nombre));
    $('cfgLiqEdificios').innerHTML = edificios.length
      ? edificios.map(b => '<label class="cfg-check"><input type="checkbox" data-cfg-gastos="' + esc(b.id) + '"' + (descuentaGastos(b) ? ' checked' : '') + '> ' +
          esc(b.nombre) + ': descontar gastos <span class="muted">(comisión: ' + esc(comisionLabel(b)) + ')</span></label>').join('')
      : '<span class="muted">Todavía no hay edificios.</span>';
    $('cfgVersion').textContent = window.rcApp && window.rcApp.version ? 'R' + window.rcApp.version : '';

    let pin = null;
    try { pin = JSON.parse(localStorage.getItem('renthouse.pin') || 'null'); } catch (err) { pin = null; }
    $('cfgPin').textContent = pin && pin.hash
      ? 'Activado · bloqueo ' + (Number(pin.autoMin) > 0 ? 'tras ' + pin.autoMin + ' min sin uso' : 'solo al abrir la aplicación')
      : 'Desactivado: cualquiera con acceso al equipo puede abrir la aplicación.';

    // Estados que vienen del proceso principal (si no existe, fuera de Electron).
    const [carpeta, respaldo, didit, correo] = await Promise.all([
      window.rcFiles ? window.rcFiles.getFolder() : null,
      window.rcBackup ? window.rcBackup.status() : null,
      window.rcDidit ? window.rcDidit.status() : null,
      window.rcCorreo ? window.rcCorreo.status() : null
    ]);
    $('cfgCorreo').textContent = correo && correo.configured
      ? 'Activado · los recordatorios salen desde ' + correo.user
      : 'Sin configurar: los recordatorios por correo se abren en tu programa de correo.';
    $('cfgCarpeta').textContent = carpeta && carpeta.path ? carpeta.path + (carpeta.exists ? '' : ' (no encontrada)') : 'Sin elegir: aquí van los contratos, modelos, expedientes y respaldos.';
    $('cfgCarpeta').title = carpeta && carpeta.path ? carpeta.path : '';
    $('cfgRespaldo').textContent = respaldo
      ? (respaldo.last ? 'Último: ' + new Date(respaldo.last.mtime).toLocaleString([], { dateStyle:'short', timeStyle:'short' }) : 'Todavía no hay respaldos') +
        ' · se guardan ' + respaldo.keep + ' días' + (respaldo.inWorkFolder ? ' en la carpeta de trabajo' : ' en la carpeta de la aplicación')
      : 'No disponible fuera de la aplicación de escritorio.';
    $('cfgDidit').textContent = didit && didit.configured
      ? 'Activada · ' + plural(didit.usoMes || 0, 'consulta', 'consultas') + ' este mes'
      : 'Sin configurar: confirma si una cédula existe en el registro de la JCE.';
  }

  cfgView.addEventListener('change', async (e) => {
    const gastosEl = e.target.closest('[data-cfg-gastos]');
    if (gastosEl) {
      const b = byId(db.edificios, gastosEl.dataset.cfgGastos);
      if (!b) return;
      b.descontarGastos = gastosEl.checked;
      if (await persist()) { mostrarGuardado(); renderNavCounts(); }
      return;
    }
    const el = e.target.closest('[data-ajuste]');
    if (!el) return;
    let valor = el.value.trim();
    if (el.dataset.tipo === 'numero') {
      valor = valor === '' ? null : Number(valor);
      const min = el.min !== '' ? Number(el.min) : null;
      const max = el.max !== '' ? Number(el.max) : null;
      if (valor !== null && (isNaN(valor) || (min !== null && valor < min) || (max !== null && valor > max))) {
        await ui.showNotice('Ese valor no es válido' + (min !== null && max !== null ? ': debe estar entre ' + min + ' y ' + max : '') + '.', 'Configuración');
        renderConfiguracion();
        return;
      }
    }
    db.ajustes = Object.assign({}, db.ajustes, { [el.dataset.ajuste]: valor === '' ? null : valor });
    if (await persist()) {
      mostrarGuardado();
      if (el.dataset.ajuste === 'papel') aplicarPapelRedactor();
      renderNavCounts();
    }
  });

  // Apariencia: preferencias de este equipo (apariencia.js las guarda y aplica).
  function renderApariencia(){
    if (!window.rcApariencia) return;
    const ap = window.rcApariencia.get();
    cfgView.querySelectorAll('[data-ap]').forEach(b => {
      const activo = String(ap[b.dataset.ap]) === b.dataset.valor;
      b.classList.toggle('active', activo);
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
    const acento = cfgView.querySelector('[data-ap="acento"].active');
    $('cfgAcentoNombre').textContent = (acento ? acento.title + ' · ' : '') + 'botones, enlaces y selección.';
  }

  cfgView.addEventListener('click', async (e) => {
    const opcion = e.target.closest('[data-ap]');
    if (opcion && window.rcApariencia) {
      window.rcApariencia.set(opcion.dataset.ap, opcion.dataset.valor);
      renderApariencia();
      mostrarGuardado();
      return;
    }
    if (e.target.closest('[data-ap-reset]') && window.rcApariencia) {
      window.rcApariencia.reset();
      renderApariencia();
      mostrarGuardado('✓ Apariencia restablecida');
      return;
    }
    const menu = e.target.closest('[data-cfg-menu]');
    if (menu) {
      const quiereRecortado = menu.dataset.cfgMenu === 'recortado';
      if (document.documentElement.classList.contains('nav-collapsed') !== quiereRecortado) btnNavToggle.click();
      renderConfiguracion();
      return;
    }
    const accion = e.target.closest('[data-cfg-accion]');
    if (!accion) return;
    if (accion.dataset.cfgAccion === 'carpeta' && window.rcFiles) {
      const r = await window.rcFiles.chooseFolder();
      if (!r.canceled) {
        await ed.listTemplates(); // refresca la biblioteca del redactor
        mostrarGuardado('✓ Carpeta cambiada');
      }
      renderConfiguracion();
    }
    if (accion.dataset.cfgAccion === 'respaldos' && window.rcBackup) window.rcBackup.open();
  });

  // Al cerrar las ventanas de JCE y PIN se refresca la vista.
  ['diditClose', 'pinSetupSave', 'pinRemove', 'pinSetupCancel'].forEach(id => {
    const b = $(id);
    if (b) b.addEventListener('click', () => setTimeout(() => { if (activeView === 'configuracion') renderConfiguracion(); }, 300));
  });

  // Papel predeterminado también para el redactor.
  function aplicarPapelRedactor(){
    const sel = $('paperSizeSelect');
    if (sel && [...sel.options].some(o => o.value === ajuste('papel')) && sel.value !== ajuste('papel')) {
      sel.value = ajuste('papel');
      sel.dispatchEvent(new Event('change')); // redibuja la página con el nuevo tamaño
    }
  }

  // ---------- Respaldo automático (estado en el menú) ----------
  const backupBtn = $('backupStatus');
  async function refreshBackupStatus(){
    if (!window.rcBackup) return;
    try {
      const s = await window.rcBackup.status();
      backupBtn.hidden = false;
      let texto = 'Sin respaldos todavía';
      let viejo = true;
      if (s.last) {
        const d = new Date(s.last.mtime);
        const dias = daysBetween(toDateStr(d), todayStr());
        const hora = d.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
        texto = dias === 0 ? 'Hoy, ' + hora : dias === 1 ? 'Ayer, ' + hora : fmtDate(toDateStr(d));
        viejo = dias > 1;
      }
      $('backupStatusText').textContent = texto;
      backupBtn.classList.toggle('is-old', viejo);
      backupBtn.title = 'Copia diaria de todos los datos (se guardan los últimos ' + s.keep + ' días).\nCarpeta: ' + s.dir +
        (s.inWorkFolder ? '' : '\nElige una carpeta de trabajo en el Redactor para guardarlos ahí (por ejemplo, en OneDrive).') +
        '\nPara restaurar uno, usa "Importar respaldo". Clic para abrir la carpeta.';
    } catch (err) {
      backupBtn.hidden = true;
    }
  }
  backupBtn.addEventListener('click', () => window.rcBackup && window.rcBackup.open());

  // ---------- Formulario genérico ----------
  // Cada formulario se describe con una lista de campos:
  // { name, label, type: text|number|date|select|textarea|tel|email,
  //   required, full, options:[{value,label}], placeholder, help, min, max, step }
  const formOverlay = $('mgmtFormOverlay');
  const formEl = $('mgmtForm');
  const formFields = $('mgmtFormFields');
  let formConfig = null;

  function fieldHtml(f, value){
    const id = 'mf-' + f.name;
    // Título de sección dentro del formulario (no es un campo).
    if (f.type === 'heading') {
      return '<div class="full form-heading">' + esc(f.label) + (f.help ? '<span>' + esc(f.help) + '</span>' : '') + '</div>';
    }
    // Varias casillas (valor: lista de valores marcados).
    if (f.type === 'checks') {
      const marcados = new Set(Array.isArray(value) ? value : []);
      const opts = f.options || [];
      return '<div class="' + (f.full ? 'full' : '') + '"><label>' + esc(f.label) + '</label>' +
        (opts.length
          ? '<div class="check-list">' + opts.map((o, i) => '<label class="check-item"><input type="checkbox" name="' + f.name + '" id="' + id + '-' + i + '" value="' + esc(o.value) + '"' +
              (marcados.has(o.value) ? ' checked' : '') + '> ' + esc(o.label) + '</label>').join('') + '</div>'
          : '<div class="field-help">' + esc(f.empty || 'No hay opciones.') + '</div>') +
        (f.help ? '<div class="field-help">' + esc(f.help) + '</div>' : '') + '</div>';
    }
    // Una sola casilla (valor: true/false).
    if (f.type === 'checkbox') {
      return '<div class="' + (f.full ? 'full' : '') + '"><label class="check-item check-single"><input type="checkbox" id="' + id + '" name="' + f.name + '"' + (value ? ' checked' : '') + '> ' + esc(f.label) + '</label>' +
        (f.help ? '<div class="field-help">' + esc(f.help) + '</div>' : '') + '</div>';
    }
    const v = value == null ? '' : value;
    const attrs = ' id="' + id + '" name="' + f.name + '"' + (f.required ? ' required' : '') +
      (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') +
      (f.min != null ? ' min="' + f.min + '"' : '') + (f.max != null ? ' max="' + f.max + '"' : '') + (f.step ? ' step="' + f.step + '"' : '');
    let control;
    if (f.type === 'select') {
      const opts = (f.options || []).slice();
      if (f.required && !opts.some(o => o.value === v)) opts.unshift({ value:'', label:'Selecciona...' });
      control = '<select' + attrs + '>' + opts.map(o => '<option value="' + esc(o.value) + '"' + (o.value === v ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('') + '</select>';
    } else if (f.type === 'textarea') {
      control = '<textarea' + attrs + '>' + esc(v) + '</textarea>';
    } else {
      control = '<input type="' + (f.type || 'text') + '"' + attrs + ' value="' + esc(v) + '" autocomplete="off">';
    }
    return '<div class="' + (f.full ? 'full' : '') + '"><label for="' + id + '">' + esc(f.label) + (f.required ? '<span class="req">*</span>' : '') + '</label>' + control +
      (f.help ? '<div class="field-help">' + esc(f.help) + '</div>' : '') +
      (f.documento ? '<div class="field-help doc-check" id="docchk-' + f.name + '" aria-live="polite"></div>' : '') +
      (f.autocompletar ? '<div class="doc-sugerencia" id="docsug-' + f.name + '" aria-live="polite"></div>' : '') +
      (f.autocompletar ? '<div class="doc-jce" id="docjce-' + f.name + '" aria-live="polite"></div>' : '') + '</div>';
  }

  // Indicación en vivo bajo un campo de cédula/RNC (f.documento).
  // escrito: true si viene de lo que el usuario está tecleando (no al abrir
  // el formulario), para no mostrar "no encontrado" en registros existentes.
  function actualizarDocCheck(f, escrito){
    const el = $('docchk-' + f.name);
    const input = formFields.querySelector('[name="' + f.name + '"]');
    if (!el || !input) return;
    const r = revisarDocumento(input.value, f.documento === 'cedula-rnc');
    el.textContent = r.mensaje;
    el.className = 'field-help doc-check doc-' + r.estado;
    if (f.autocompletar) {
      actualizarSugerencia(f, r, escrito);
      actualizarJce(f, r, escrito);
    }
  }

  // ---------- Verificación con la JCE (Didit) ----------
  // Bajo una cédula válida: el resultado guardado de una verificación
  // anterior, o un botón para verificarla (gasta una consulta, por eso no
  // se hace sola al teclear).
  let jceTurno = 0;

  function jceResultadoHtml(r){
    const fecha = r.fecha ? new Date(r.fecha).toLocaleDateString() : '';
    if (r.outcome === 'MATCH') return '<span class="jce-ok">✓ La JCE confirma que esta cédula existe' + (r.datos && r.datos.nombre ? ': <b>' + esc(r.datos.nombre) + '</b>' : '') + '.</span><span class="muted">Verificada ' + esc(fecha) + '</span>';
    if (r.outcome === 'NO_MATCH') return '<span class="jce-no">✗ La JCE no encontró esta cédula. Revísala con el documento físico.</span><span class="muted">Consultada ' + esc(fecha) + '</span>';
    return '<span class="muted">Didit no dio un resultado concluyente (' + esc(r.outcome || '—') + '). Puedes intentarlo más tarde.</span>';
  }

  // Si la JCE devolvió el nombre, se ofrece como cualquier otra sugerencia.
  function usarNombreJce(f, r){
    if (r.outcome !== 'MATCH' || !r.datos || !r.datos.nombre || sugerencia || autoRelleno) return;
    ofrecerDatos(f, $('docsug-' + f.name), { nombre: nombrePropio(r.datos.nombre) }, 'JCE', 'Usar el nombre');
  }

  async function actualizarJce(f, revision, escrito){
    const el = $('docjce-' + f.name);
    const input = formFields.querySelector('[name="' + f.name + '"]');
    if (!el || !input) return;
    const turno = ++jceTurno;
    el.innerHTML = '';
    const id = input.value.replace(/\D+/g, '');
    if (!window.rcDidit || !revision || revision.estado !== 'valida' || id.length !== 11) return;
    const [estado, guardado] = await Promise.all([window.rcDidit.status(), window.rcDidit.cached(id)]);
    if (turno !== jceTurno) return;
    if (guardado) {
      el.innerHTML = jceResultadoHtml(guardado);
      usarNombreJce(f, guardado);
    } else if (estado.configured) {
      el.innerHTML = '<button type="button" class="btn-panel jce-btn" data-jce-verify="' + esc(f.name) + '">Verificar con la JCE</button>' +
        '<span class="muted">Usa 1 consulta de Didit' + (estado.usoMes ? ' · ' + estado.usoMes + ' este mes' : '') + '</span>';
    } else if (escrito) {
      el.innerHTML = '<span class="muted">¿Confirmar que la cédula existe?</span><button type="button" class="link-btn" data-didit-open>Configurar verificación con la JCE</button>';
    }
  }

  formFields.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-jce-verify]');
    if (!btn || !formConfig) return;
    const f = formConfig.fields.find(x => x.name === btn.dataset.jceVerify);
    const input = f && formFields.querySelector('[name="' + f.name + '"]');
    if (!input) return;
    const el = $('docjce-' + f.name);
    btn.disabled = true;
    btn.textContent = 'Verificando…';
    const r = await window.rcDidit.verify(input.value);
    if (!$('docjce-' + f.name)) return; // se cerró el formulario mientras tanto
    if (!r.ok) {
      if (r.error === 'sin-clave') { abrirDidit(); el.innerHTML = ''; return; }
      el.innerHTML = '<span class="jce-no">' + esc(r.error) + '</span><button type="button" class="link-btn" data-jce-verify="' + esc(f.name) + '">Reintentar</button>';
      return;
    }
    el.innerHTML = jceResultadoHtml(r);
    usarNombreJce(f, r);
  });

  // Ventana de configuración (clave de API).
  const diditOverlay = $('diditOverlay');
  async function refreshDiditStatus(){
    const s = window.rcDidit ? await window.rcDidit.status() : { configured:false };
    $('diditStatus').innerHTML = s.configured
      ? badge('pagado', 'Configurado') + ' <span>Clave guardada (cifrada) · ' + plural(s.usoMes || 0, 'consulta', 'consultas') + ' este mes desde este equipo.</span>'
      : badge('pendiente', 'Sin configurar') + ' <span>' + (window.rcDidit ? 'Pega tu clave de API de Didit para activar la verificación.' : 'Disponible solo en la aplicación de escritorio.') + '</span>';
    $('diditRemove').hidden = !s.configured;
    $('diditTest').hidden = !s.configured;
    $('diditSave').disabled = !window.rcDidit;
  }

  async function probarClaveDidit(){
    const el = $('diditPrueba');
    el.className = 'didit-prueba';
    el.textContent = 'Probando la clave…';
    $('diditTest').disabled = true;
    try {
      const r = await window.rcDidit.test();
      el.className = 'didit-prueba ' + (r.ok ? 'ok' : 'error');
      el.textContent = r.ok ? '✓ ' + r.mensaje : r.error;
    } finally {
      $('diditTest').disabled = false;
    }
  }

  async function abrirDidit(){
    $('diditKey').value = '';
    $('diditPrueba').textContent = '';
    $('diditPrueba').className = 'didit-prueba';
    await refreshDiditStatus();
    diditOverlay.classList.add('show');
    $('diditKey').focus();
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-didit-open]')) abrirDidit(); });
  $('diditClose').addEventListener('click', () => diditOverlay.classList.remove('show'));
  $('diditWeb').addEventListener('click', () => window.open('https://didit.me', '_blank'));
  $('diditTest').addEventListener('click', probarClaveDidit);
  $('diditSave').addEventListener('click', async () => {
    const r = await window.rcDidit.setKey($('diditKey').value);
    if (!r.ok) { await ui.showNotice(r.error, 'Verificación JCE'); return; }
    $('diditKey').value = '';
    await refreshDiditStatus();
    await probarClaveDidit(); // al guardar se comprueba enseguida, sin gastar consultas
    // Si había un formulario abierto, aparece ya el botón de verificar.
    if (formConfig) formConfig.fields.filter(f => f.autocompletar).forEach(f => actualizarDocCheck(f, true));
  });
  $('diditKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('diditSave').click(); });
  $('diditRemove').addEventListener('click', async () => {
    if (!(await ui.showConfirmDialog('¿Quitar la clave de Didit de este equipo? Las cédulas ya verificadas se siguen recordando.', 'Verificación JCE'))) return;
    await window.rcDidit.removeKey();
    await refreshDiditStatus();
  });

  // ---------- Autocompletar por documento ----------
  // Al escribir una cédula o un RNC se buscan datos en los propios registros
  // (inquilinos, propietarios y fiadores).
  // f.autocompletar = { tipo: 'inquilino'|'propietario'|'fiador', excluir: id,
  //                     campos: { nombre: 'campoDelFormulario', telefono: ..., ... } }
  let sugerencia = null;      // { campo, datos } que aplica "Usar sus datos"

  function personasConDocumento(clave){
    const out = [];
    db.inquilinos.forEach(t => { if (claveDocumento(t.documento) === clave) out.push({ tipo:'inquilino', id:t.id, datos:t, etiqueta:'inquilino' }); });
    db.propietarios.forEach(p => { if (claveDocumento(p.documento) === clave) out.push({ tipo:'propietario', id:p.id, datos:p, etiqueta:'propietario' }); });
    db.contratos.forEach(c => {
      if (c.fiadorNombre && claveDocumento(c.fiadorDocumento) === clave) {
        out.push({ tipo:'fiador', id:c.id, etiqueta:'fiador (' + contractTitle(c) + ')',
          datos:{ nombre:c.fiadorNombre, documento:c.fiadorDocumento, telefono:c.fiadorTelefono, direccion:c.fiadorDireccion } });
      }
    });
    return out;
  }

  // "INVERSIONES DEL CARIBE S.R.L." -> "Inversiones del Caribe S.R.L."
  function nombrePropio(s){
    const menores = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e']);
    const siglas = /^(s\.?r\.?l\.?|s\.?a\.?s?\.?|e\.?i\.?r\.?l\.?|srl|sa|sas|eirl|rd|ii|iii|iv)$/i;
    return String(s || '').trim().toLowerCase().split(/\s+/).map((w, i) =>
      siglas.test(w) ? w.toUpperCase() : (i > 0 && menores.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  }

  function actualizarSugerencia(f, revision, escrito){
    const el = $('docsug-' + f.name);
    const input = formFields.querySelector('[name="' + f.name + '"]');
    if (!el || !input) return;
    sugerencia = null;
    el.innerHTML = '';
    // Si cambió el documento, lo que se rellenó con el anterior ya no vale.
    quitarAutoRelleno(f.name);
    const clave = claveDocumento(input.value);
    if (clave.length < 6) return;
    const cfg = f.autocompletar;

    // 1) Propios registros (sin contar el registro que se está editando).
    const propios = personasConDocumento(clave).filter(x => !(x.tipo === cfg.tipo && x.id === cfg.excluir));
    const mismoTipo = cfg.tipo !== 'fiador' && propios.find(x => x.tipo === cfg.tipo);
    if (mismoTipo) {
      el.innerHTML = '<span>Ya hay un ' + esc(cfg.tipo) + ' con este documento: <b>' + esc(mismoTipo.datos.nombre) + '</b>.</span>';
      return;
    }
    if (propios.length) {
      ofrecerDatos(f, el, propios[0].datos, 'Registrado como ' + propios[0].etiqueta, 'Usar sus datos');
      return;
    }

    // Al abrir un registro, o si otra fuente (la JCE) ya propuso datos, no se dice nada.
    if (!escrito || sugerencia || autoRelleno || !revision || revision.estado !== 'valida') return;
    el.innerHTML = '<span class="muted">No está en tus registros. Completa los datos a mano.</span>';
  }

  // Si los campos a rellenar están vacíos se rellenan solos (con "Deshacer");
  // si ya tienen algo escrito, se pregunta con un botón para no pisarlo.
  let autoRelleno = null; // { campo, puestos: { campoForm: valor } } para deshacer o limpiar

  function camposDestino(f){
    return Object.entries(f.autocompletar.campos)
      .map(([dato, campo]) => ({ dato, campo, input: formFields.querySelector('[name="' + campo + '"]') }))
      .filter(x => x.input);
  }

  function ofrecerDatos(f, el, datos, origen, textoBoton, extra){
    sugerencia = { campo: f.name, datos, origen };
    const destino = camposDestino(f).filter(x => datos[x.dato]);
    if (destino.length && destino.every(x => !x.input.value.trim())) {
      aplicarSugerencia(f);
      return;
    }
    el.innerHTML = '<span>' + esc(origen) + ': <b>' + esc(datos.nombre) + '</b>' + esc(extra || '') + '</span>' +
      '<button type="button" class="link-btn" data-autofill>' + esc(textoBoton) + '</button>';
  }

  function aplicarSugerencia(f){
    const puestos = {};
    camposDestino(f).forEach(({ dato, campo, input }) => {
      const valor = sugerencia.datos[dato];
      if (!valor) return;
      input.value = valor;
      puestos[campo] = valor;
    });
    autoRelleno = { campo: f.name, puestos };
    $('docsug-' + f.name).innerHTML = '<span class="doc-sug-ok">✓ Completado con los datos de ' + esc(sugerencia.origen.replace(/^Registrado como /, '')) +
      ': ' + esc(sugerencia.datos.nombre) + '. Revísalos antes de guardar.</span><button type="button" class="link-btn" data-autofill-deshacer>Deshacer</button>';
    sugerencia = null;
  }

  // Quita lo rellenado automáticamente (si nadie lo cambió después).
  function quitarAutoRelleno(campoDocumento){
    if (!autoRelleno || autoRelleno.campo !== campoDocumento) return;
    Object.entries(autoRelleno.puestos).forEach(([campo, valor]) => {
      const input = formFields.querySelector('[name="' + campo + '"]');
      if (input && input.value === valor) input.value = '';
    });
    autoRelleno = null;
  }

  formFields.addEventListener('click', (e) => {
    if (!formConfig) return;
    if (e.target.closest('[data-autofill-deshacer]') && autoRelleno) {
      const campoDoc = autoRelleno.campo;
      quitarAutoRelleno(campoDoc);
      $('docsug-' + campoDoc).innerHTML = '<span class="muted">Se quitaron los datos completados.</span>';
      return;
    }
    if (!e.target.closest('[data-autofill]') || !sugerencia) return;
    const f = formConfig.fields.find(x => x.name === sugerencia.campo);
    if (f) aplicarSugerencia(f);
  });

  function openForm(cfg){
    formConfig = cfg;
    $('mgmtFormTitle').textContent = cfg.title;
    $('mgmtFormSub').textContent = cfg.subtitle || '';
    $('mgmtFormSub').hidden = !cfg.subtitle;
    formFields.innerHTML = cfg.fields.map(f => fieldHtml(f, cfg.values[f.name])).join('');
    autoRelleno = null;
    sugerencia = null;
    cfg.fields.filter(f => f.documento).forEach(f => actualizarDocCheck(f, false));
    if (cfg.afterRender) cfg.afterRender(formFields);
    formOverlay.classList.add('show');
    const first = formFields.querySelector('input:not([type="checkbox"]), select, textarea');
    if (first) first.focus();
  }

  function closeForm(){
    formOverlay.classList.remove('show');
    formConfig = null;
  }

  formEl.addEventListener('input', (e) => {
    if (!formConfig || !e.target.name) return;
    const campoDoc = formConfig.fields.find(f => f.documento && f.name === e.target.name);
    if (campoDoc) actualizarDocCheck(campoDoc, true);
    if (formConfig.onInput) formConfig.onInput(formFields, e.target.name);
  });

  formEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!formConfig) return;
    const cfg = formConfig;
    const values = {};
    for (const f of cfg.fields) {
      if (f.type === 'heading') continue;
      if (f.type === 'checks') {
        values[f.name] = [...formFields.querySelectorAll('[name="' + f.name + '"]:checked')].map(x => x.value);
        continue;
      }
      const el = formFields.querySelector('[name="' + f.name + '"]');
      if (f.type === 'checkbox') {
        values[f.name] = el.checked;
        continue;
      }
      let v = f.type === 'password' ? el.value : el.value.trim();
      if (f.required && !v) {
        await ui.showNotice('Completa el campo "' + f.label + '".', 'Falta información');
        el.focus();
        return;
      }
      if (f.type === 'number') {
        v = v === '' ? null : Number(v);
        if (v != null && (isNaN(v) || v < 0)) {
          await ui.showNotice('El campo "' + f.label + '" debe ser un número válido.', 'Dato no válido');
          el.focus();
          return;
        }
      }
      values[f.name] = v;
    }
    // Cédulas y RNC: se guardan con su formato; si el dígito verificador no
    // coincide (o faltan dígitos) se pregunta antes de guardar.
    for (const f of cfg.fields.filter(x => x.documento)) {
      const r = revisarDocumento(values[f.name], f.documento === 'cedula-rnc');
      if (r.formateado) values[f.name] = r.formateado;
      if (r.estado === 'invalida' || r.estado === 'formato') {
        const ok = await ui.showConfirmDialog('"' + f.label + '": ' + values[f.name] + '. ' + r.mensaje + ' ¿Guardar de todos modos?', 'Revisa el documento');
        if (!ok) {
          formFields.querySelector('[name="' + f.name + '"]').focus();
          return;
        }
      }
    }
    const saveBtn = $('mgmtFormSave');
    saveBtn.disabled = true;
    try {
      const result = await cfg.onSave(values);
      if (typeof result === 'string') { await ui.showNotice(result, 'Revisa los datos'); return; }
      if (result === false) return;
      if (formConfig === cfg) closeForm();
      renderActive();
    } finally {
      saveBtn.disabled = false;
    }
  });

  $('mgmtFormCancel').addEventListener('click', closeForm);

  // ---------- Acciones de todas las vistas ----------
  const ACTIONS = {
    'nuevo-edificio': () => openEdificioForm(),
    'editar-edificio': (id) => openEdificioForm(id),
    'borrar-edificio': deleteEdificio,
    'ver-unidades': (id) => { showView('unidades'); filterUnidadesEdificio.value = id; renderUnidades(); },
    'nueva-unidad': () => openUnidadForm(),
    'nueva-unidad-en': (id) => {
      const b = byId(db.edificios, id);
      openUnidadForm(null, { edificioId: id, piso: b && b.pisos > 1 ? b.pisos : 1 });
    },
    // Casilla de un apartamento: si está ocupado abre la ficha del
    // inquilino (con su contrato y documento); si está libre, alquilarlo.
    'tile': (id) => {
      const c = activeContractOfUnit(id);
      if (c && byId(db.inquilinos, c.inquilinoId)) openTenantDetail(c.inquilinoId);
      else if (c) openContratoForm(c.id);
      else openContratoForm(null, { unidadId: id });
    },
    'editar-unidad': (id) => openUnidadForm(id),
    'borrar-unidad': deleteUnidad,
    'alquilar': (id) => openContratoForm(null, { unidadId: id }),
    'nuevo-inquilino': () => openInquilinoForm(),
    'ver-inquilino': openTenantDetail,
    'contrato-inquilino': (id) => openContratoForm(null, { inquilinoId: id }),
    'borrar-inquilino': deleteInquilino,
    'nuevo-contrato': () => openContratoForm(),
    'editar-contrato': (id) => openContratoForm(id),
    'finalizar': finalizeContrato,
    'borrar-contrato': deleteContrato,
    'documento': openContractDocument,
    'contrato-pdf': contratoPdf,
    'subir-firmado': subirFirmado,
    'ver-firmado': (id) => { const c = byId(db.contratos, id); if (c && c.firmado) abrirArchivoContrato(c, c.firmado.archivo); },
    'pagar': (id, btn) => openPagoForm(null, { contratoId: id, periodo: btn.dataset.periodo || monthOf(todayStr()) }),
    'recibo': (id) => printRecibo(id),
    'recibo-pdf': (id) => printRecibo(id, true),
    'editar-pago': (id) => openPagoForm(id),
    'borrar-pago': deletePago,
    'nuevo-gasto': () => openGastoForm(),
    'editar-gasto': (id) => openGastoForm(id),
    'duplicar-gasto': (id) => {
      const g = byId(db.gastos, id);
      if (!g) return;
      const copia = Object.assign({}, g, { fecha: todayStr() });
      delete copia.id;
      delete copia.creado;
      openGastoForm(null, copia);
    },
    'borrar-gasto': deleteGasto,
    'nuevo-propietario': () => openPropietarioForm(),
    'editar-propietario': (id) => openPropietarioForm(id),
    'borrar-propietario': deletePropietario,
    'ver-liquidacion': (id, btn) => {
      if (btn.dataset.periodo) { liqMes.value = btn.dataset.periodo; setLiqModo('mes'); }
      liqPropFiltro = id || '';
      showView('liquidaciones');
    },
    'registrar-liquidacion': openLiquidacionForm,
    'anular-liquidacion': anularLiquidacion,
    'estado-cuenta': printEstadoCuenta,
    'renovar': openRenovarForm,
    'deposito': openDepositoForm,
    'estado-cuenta-inquilino': printEstadoCuentaInquilino,
    'recordar': openRecordatorio,
    'condonar-recargo': (id, btn) => toggleRecargo(id, btn.dataset.periodo, true),
    'restituir-recargo': (id, btn) => toggleRecargo(id, btn.dataset.periodo, false),
    'nota-agregar': (id) => {
      const texto = $('notaTexto').value;
      if (texto.trim()) registrarSeguimiento(id, texto);
    },
    'nota-borrar': borrarNota,
    'exp-adjuntar': adjuntarExpediente,
    'exp-carpeta': (id) => {
      const t = byId(db.inquilinos, id);
      if (t && t.expedienteCarpeta) window.rcExpediente.open(t.expedienteCarpeta);
    },
    'exp-abrir': (name) => {
      const t = byId(db.inquilinos, tenantDetailId);
      if (t && t.expedienteCarpeta) window.rcExpediente.open(t.expedienteCarpeta, name);
    },
    'exp-borrar': borrarArchivoExpediente,
    'exportar-excel': exportarExcel,
    'nuevo-caso': () => openCasoForm(),
    'aumento': openAumentoForm,
    'acta': (id) => { const [cid, tipo] = id.split('|'); openActa(cid, tipo); },
    'nueva-reparacion': () => openReparacionForm(),
    'editar-reparacion': (id) => openReparacionForm(id),
    'resolver-reparacion': openResolverForm,
    'reparacion-proceso': async (id) => { const r = byId(db.reparaciones, id); if (r) { r.estado = 'proceso'; await persist(); renderActive(); } },
    'borrar-reparacion': borrarReparacion,
    'estados-cuenta-mes': (id, btn) => abrirEnvio(btn.dataset.periodo),
    'abrir-caso': (id) => openCasoForm(null, { contratoId: id }),
    'ver-caso': openCaso,
    'ir-agenda': () => showView('agenda'),
    'ir-mantenimiento': () => showView('mantenimiento'),
    'evento-hecho': toggleEventoHecho,
    'editar-evento': (id) => openEventoForm(id),
    'borrar-evento': borrarEvento,
    'nuevo-evento-dia': (dia) => openEventoForm(null, { fecha: dia }),
    'agenda-todo': () => { agendaDia = null; renderAgenda(); }
  };
  document.querySelectorAll('.view:not([data-view="redactor"])').forEach(v => bindActions(v, ACTIONS));
  bindActions(tenantDetailBody, ACTIONS);

  // ---------- Respaldo (exportar / importar) ----------
  $('btnExportData').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(Object.assign({ exportado: new Date().toISOString() }, db), null, 2)], { type:'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'renthouse-respaldo-' + todayStr() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  const importInput = $('importDataInput');
  $('btnImportData').addEventListener('click', () => { importInput.value = ''; importInput.click(); });
  importInput.addEventListener('change', async () => {
    const file = importInput.files[0];
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch (err) {
      await ui.showNotice('El archivo no es un respaldo válido.', 'No se pudo importar');
      return;
    }
    if (!data || !REQUIRED_COLLECTIONS.every(k => Array.isArray(data[k]))) {
      await ui.showNotice('El archivo no tiene el formato de un respaldo de RentHouse.', 'No se pudo importar');
      return;
    }
    const resumen = COLLECTIONS.filter(k => Array.isArray(data[k])).map(k => data[k].length + ' ' + k).join(', ');
    if (!(await ui.showConfirmDialog('El respaldo contiene: ' + resumen + '. Reemplazará TODOS los datos actuales. ¿Continuar?', 'Importar respaldo'))) return;
    const previous = db;
    db = normalizeDb(data);
    migrateDb();
    linkedContractId = null;
    if (!(await persist())) { db = previous; return; }
    renderActive();
    await ui.showNotice('Respaldo importado correctamente.', 'Listo');
  });

  // ---------- Inicio ----------
  (async function init(){
    await loadDb();
    let start = 'resumen';
    try { start = localStorage.getItem(VIEW_KEY) || 'resumen'; } catch (err) { /* no crítico */ }
    aplicarPapelRedactor();
    aplicarPlan(planLicencia);
    showView(start);
    refreshBackupStatus();
    avisarAgenda();
    if (window.rcApp && window.rcApp.version) $('appVersion').textContent = 'R' + window.rcApp.version;
  })();
})();
