(function(){
  // ---------------------------------------------------------------
  // Ayuda: recorrido interactivo por la aplicación (todo menos
  // Configuración). El botón "?" de la barra superior abre un menú para
  // hacer el recorrido completo, el de la pantalla actual o el de una
  // sección. Cada paso lleva a su pantalla, resalta un elemento y lo
  // explica en una tarjeta (← → para moverse, Esc para salir).
  // ---------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const VISTO_KEY = 'renthouse.tourVisto';

  // Secciones en el orden del menú lateral. "vista" es la pantalla que se
  // abre; cada paso resalta "sel" (si no está visible, la tarjeta sale al centro).
  const SECCIONES = [
    { id:'general', titulo:'Primeros pasos', vista:null, pasos:[
      { sel:'#sideNav', titulo:'Menú', texto:'Todas las secciones de la aplicación. Los números marcan lo pendiente.' },
      { sel:'#btnBuscar', soloCompleto:true, titulo:'Búsqueda', texto:'Encuentra un inquilino, cédula, apartamento o contrato desde cualquier pantalla. Atajo: Ctrl+K.' },
      { sel:'#btnNavToggle', titulo:'Menú recortado', texto:'Deja solo los iconos para ganar espacio.' },
      { sel:'#btnAyuda', titulo:'Ayuda', texto:'Vuelve aquí cuando quieras: recorrido completo, de esta pantalla o de una sección.' }
    ]},
    { id:'resumen', titulo:'Resumen', vista:'resumen', pasos:[
      { sel:'#dashStats', titulo:'Cifras del día', texto:'Ocupación, alquiler mensual y cobros del mes.' },
      { sel:'#dashAlerts', titulo:'Requieren atención', texto:'Pagos atrasados, liquidaciones, vencimientos, aumentos y agenda. Cada aviso trae su botón para resolverlo.' },
      { sel:'#dashBuildings', titulo:'Ocupación', texto:'Cuántos apartamentos están ocupados en cada edificio.' }
    ]},
    { id:'propietarios', titulo:'Propietarios', vista:'propietarios', pasos:[
      { sel:'[data-view="propietarios"] [data-new="propietario"]', titulo:'Nuevo propietario', texto:'Datos del dueño y la cuenta a la que se le transfiere.' },
      { sel:'#tablePropietarios', titulo:'Lista', texto:'Sus inmuebles y un acceso directo a su liquidación.' }
    ]},
    { id:'edificios', titulo:'Edificios', vista:'edificios', pasos:[
      { sel:'[data-view="edificios"] [data-new="edificio"]', titulo:'Nuevo edificio', texto:'Indica cuántos apartamentos y pisos tiene: se crean solos. Aquí se fija tu comisión.' },
      { sel:'#tableEdificios', titulo:'Planta del edificio', texto:'Cada casilla es un apartamento. Clic en uno libre para alquilarlo, o en uno ocupado para ver al inquilino.' }
    ]},
    { id:'unidades', titulo:'Apartamentos', vista:'unidades', pasos:[
      { sel:'#filterUnidadesEstado', titulo:'Filtros', texto:'Busca por edificio o muestra solo los disponibles u ocupados.' },
      { sel:'#tableUnidades', titulo:'Apartamentos', texto:'Alquila, edita o dale a uno un dueño o comisión distintos a los del edificio.' }
    ]},
    { id:'inquilinos', titulo:'Inquilinos', vista:'inquilinos', pasos:[
      { sel:'[data-view="inquilinos"] [data-new="inquilino"]', titulo:'Nuevo inquilino', texto:'La cédula se valida al escribirla y puede verificarse con la JCE.' },
      { sel:'#tableInquilinos', titulo:'Ficha', texto:'Abre la ficha para ver contratos, pagos y deuda.' }
    ]},
    { id:'contratos', titulo:'Contratos', vista:'contratos', pasos:[
      { sel:'[data-view="contratos"] [data-new="contrato"]', titulo:'Nuevo contrato', texto:'Une un inquilino con un apartamento: monto, fechas, depósito, mora y fiador.' },
      { sel:'#tableContratos', titulo:'Acciones', texto:'En el menú ⋯: redactar el documento, depósito, aumento, acta de entrega o abrir un caso.' }
    ]},
    { id:'mantenimiento', titulo:'Mantenimiento', vista:'mantenimiento', pasos:[
      { sel:'[data-view="mantenimiento"] [data-new="reparacion"]', titulo:'Nueva solicitud', texto:'Averías del apartamento o de las áreas comunes, con prioridad.' },
      { sel:'#tableReparaciones', titulo:'Seguimiento', texto:'Al resolverla, su costo puede pasar directo a Gastos.' }
    ]},
    { id:'cobros', titulo:'Cobros', vista:'cobros', pasos:[
      { sel:'#cobrosMes', titulo:'Mes', texto:'Elige el mes que quieres revisar.' },
      { sel:'#cobrosCuotas', titulo:'Cuotas', texto:'Lo que debe cada inquilino este mes. Registra el pago y emite el recibo.' },
      { sel:'#btnLote', titulo:'Recordatorios', texto:'"Enviar a todos": los correos salen solos y los WhatsApp se abren uno tras otro (Enter para el siguiente).' },
      { sel:'#cobrosPagos', titulo:'Pagos', texto:'Lo cobrado en el mes, con su recibo.' }
    ]},
    { id:'gastos', titulo:'Gastos', vista:'gastos', pasos:[
      { sel:'[data-view="gastos"] [data-new="gasto"]', titulo:'Nuevo gasto', texto:'De un apartamento o de las áreas comunes del edificio.' },
      { sel:'#gastosStats', titulo:'Totales', texto:'Lo gastado en el mes, por moneda.' }
    ]},
    { id:'liquidaciones', titulo:'Liquidaciones', vista:'liquidaciones', pasos:[
      { sel:'#liqStats', titulo:'Tu comisión', texto:'Lo que te corresponde este mes y lo que queda para los propietarios.' },
      { sel:'#liqTabla', titulo:'Por edificio', texto:'Desglose por apartamento. Registra la liquidación o imprímela.' },
      { sel:'.liq-modo', titulo:'Por mes o todo', texto:'"Todo" junta las liquidaciones de todos los meses. Filtra por pendientes para no olvidar ninguna.' },
      { sel:'#btnEnvioEstados', titulo:'Enviar', texto:'Manda a cada propietario su liquidación en PDF, por WhatsApp o correo.' }
    ]},
    { id:'balance', titulo:'Balance', vista:'balance', pasos:[
      { sel:'#balanceChart', titulo:'Ingresos y gastos', texto:'Mes a mes, por año, moneda y edificio.' },
      { sel:'#balanceCategorias', titulo:'En qué se gasta', texto:'Gastos agrupados por categoría.' }
    ]},
    { id:'reportes', titulo:'Reportes', vista:'reportes', pasos:[
      { sel:'#repMorosidad', titulo:'Morosidad', texto:'Deuda vencida por antigüedad: 30, 60, 90 días o más.' },
      { sel:'#repDepositos', titulo:'Depósitos', texto:'Depósitos que tienes en custodia.' },
      { sel:'#repAnio', titulo:'Excel', texto:'Exporta todo a un libro .xlsx para el contador.' }
    ]},
    { id:'casos', titulo:'Casos', vista:'casos', pasos:[
      { sel:'[data-view="casos"] [data-new="caso"]', titulo:'Nuevo caso', texto:'Cobro o desalojo, con etapas, requisitos y actos.' },
      { sel:'#tableCasos', titulo:'Casos', texto:'El avance de cada proceso.' }
    ]},
    { id:'agenda', titulo:'Agenda', vista:'agenda', pasos:[
      { sel:'[data-view="agenda"] [data-new="evento"]', titulo:'Nuevo evento', texto:'Audiencias, plazos, citas o tareas. Te avisa al abrir la app.' },
      { sel:'#agendaCal', titulo:'Calendario', texto:'Incluye solos los vencimientos de contratos.' }
    ]},
    { id:'redactor', titulo:'Redactor', vista:'redactor', pasos:[
      { sel:'#rdDesk', titulo:'La hoja', texto:'Escribe, pega un contrato o parte de un modelo. Se ve como se imprime.' },
      { sel:'#rdSide', titulo:'Biblioteca', texto:'Tus documentos, modelos y los campos del documento abierto.' },
      { sel:'#editorFormatbar', titulo:'Formato', texto:'Estilos, fuente, alineación, interlineado y salto de página.' },
      { sel:'#btnInsertField', titulo:'Campos', texto:'Huecos como "Nombre del inquilino" que se rellenan solos con los datos del contrato.' },
      { sel:'#paperSizeSelect', alto:'.editor-footer', titulo:'Papel y márgenes', texto:'Tamaño, márgenes, orientación y zoom de la hoja.' },
      { sel:'#btnSaveNow', titulo:'Guardar', texto:'Guarda un .doc en tu carpeta (Ctrl+S). Al lado: PDF e Imprimir (Ctrl+P).' }
    ]}
  ];

  // ---------- Elementos ----------
  const btnAyuda = $('btnAyuda');
  const menu = document.createElement('div');
  menu.className = 'tour-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.innerHTML =
    '<button type="button" class="tour-menu-principal" data-tour="todo"><strong>Recorrido completo</strong><span>Toda la aplicación, paso a paso</span></button>' +
    '<button type="button" class="tour-menu-principal" data-tour="aqui"><strong>Esta pantalla</strong><span id="tourAquiNombre"></span></button>' +
    '<div class="tour-menu-titulo">Por sección</div>' +
    '<div class="tour-menu-grid">' + SECCIONES.map(s => '<button type="button" data-tour="' + s.id + '">' + s.titulo + '</button>').join('') + '</div>';
  document.body.appendChild(menu);

  const capa = document.createElement('div');
  capa.className = 'tour-capa';
  capa.hidden = true;
  capa.innerHTML =
    '<div class="tour-foco"></div>' +
    '<div class="tour-card" role="dialog" aria-live="polite">' +
      '<button type="button" class="tour-cerrar" data-tour-acc="cerrar" title="Salir (Esc)" aria-label="Salir del recorrido">✕</button>' +
      '<div class="tour-seccion"></div>' +
      '<h3 class="tour-titulo"></h3>' +
      '<p class="tour-texto"></p>' +
      '<div class="tour-barra"><span></span></div>' +
      '<div class="tour-pie"><span class="tour-cuenta"></span>' +
        '<button type="button" class="btn-panel" data-tour-acc="atras">Anterior</button>' +
        '<button type="button" class="btn-brass" data-tour-acc="siguiente">Siguiente</button></div>' +
    '</div>';
  document.body.appendChild(capa);
  const foco = capa.querySelector('.tour-foco');
  const card = capa.querySelector('.tour-card');

  // ---------- Estado ----------
  let pasos = [];
  let indice = 0;
  let elActual = null;

  function vistaActiva(){ return document.body.dataset.activeView || 'resumen'; }
  function irAVista(vista){
    if (!vista || vistaActiva() === vista) return;
    const nav = document.querySelector('.nav-item[data-view="' + vista + '"]');
    if (nav) nav.click();
  }
  function visible(el){
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
  }

  // Con la licencia "solo redactor" no se recorre la gestión.
  function soloRedactor(){ return document.body.dataset.plan === 'redactor'; }
  function disponibles(){ return soloRedactor() ? SECCIONES.filter(s => s.id === 'general' || s.id === 'redactor') : SECCIONES; }

  function aplanar(secciones){
    return secciones.flatMap(s => s.pasos.filter(p => !(p.soloCompleto && soloRedactor())).map(p => Object.assign({ vista: s.vista, seccion: s.titulo }, p)));
  }

  function empezar(secciones){
    abrirMenu(false);
    document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
    pasos = aplanar(secciones);
    if (!pasos.length) return;
    indice = 0;
    capa.hidden = false;
    document.body.classList.add('tour-activo');
    mostrar();
  }

  function terminar(){
    capa.hidden = true;
    document.body.classList.remove('tour-activo');
    elActual = null;
    try { localStorage.setItem(VISTO_KEY, '1'); } catch (err) { /* no crítico */ }
    btnAyuda.classList.remove('pulso');
  }

  function mostrar(){
    const p = pasos[indice];
    irAVista(p.vista);
    const el = document.querySelector(p.sel);
    elActual = visible(el) ? (p.alto ? el.closest(p.alto) || el : el) : null;
    card.querySelector('.tour-seccion').textContent = p.seccion;
    card.querySelector('.tour-titulo').textContent = p.titulo;
    card.querySelector('.tour-texto').textContent = p.texto;
    card.querySelector('.tour-cuenta').textContent = (indice + 1) + ' de ' + pasos.length;
    card.querySelector('.tour-barra span').style.width = ((indice + 1) / pasos.length * 100) + '%';
    card.querySelector('[data-tour-acc="atras"]').disabled = indice === 0;
    card.querySelector('[data-tour-acc="siguiente"]').textContent = indice === pasos.length - 1 ? 'Terminar' : 'Siguiente';
    if (elActual) elActual.scrollIntoView({ block:'nearest', inline:'nearest' });
    colocar();
    card.querySelector('[data-tour-acc="siguiente"]').focus({ preventScroll:true });
  }

  // Resalta el elemento y pone la tarjeta debajo, encima o al lado, sin salirse de la ventana.
  function colocar(){
    if (capa.hidden) return;
    const M = 12, vw = window.innerWidth, vh = window.innerHeight;
    const cw = card.offsetWidth, ch = card.offsetHeight;
    if (!elActual || !visible(elActual)) {
      foco.classList.add('sin-foco');
      card.style.left = Math.round((vw - cw) / 2) + 'px';
      card.style.top = Math.round((vh - ch) / 2) + 'px';
      return;
    }
    foco.classList.remove('sin-foco');
    const r = elActual.getBoundingClientRect();
    const pad = 6;
    const top = Math.max(4, r.top - pad), left = Math.max(4, r.left - pad);
    const bottom = Math.min(vh - 4, r.bottom + pad), right = Math.min(vw - 4, r.right + pad);
    Object.assign(foco.style, { top: top + 'px', left: left + 'px', width: (right - left) + 'px', height: (bottom - top) + 'px' });
    let x, y;
    if (bottom + M + ch <= vh) { y = bottom + M; x = left; }
    else if (top - M - ch >= 0) { y = top - M - ch; x = left; }
    else if (right + M + cw <= vw) { x = right + M; y = top; }
    else if (left - M - cw >= 0) { x = left - M - cw; y = top; }
    else { x = (vw - cw) / 2; y = vh - ch - M; } // elemento enorme: tarjeta abajo, encima de él
    card.style.left = Math.round(Math.max(M, Math.min(x, vw - cw - M))) + 'px';
    card.style.top = Math.round(Math.max(M, Math.min(y, vh - ch - M))) + 'px';
  }

  function mover(delta){
    const nuevo = indice + delta;
    if (nuevo < 0) return;
    if (nuevo >= pasos.length) { terminar(); return; }
    indice = nuevo;
    mostrar();
  }

  // ---------- Menú de ayuda ----------
  function abrirMenu(abrir){
    menu.hidden = !abrir;
    btnAyuda.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    if (!abrir) return;
    const lista = disponibles();
    menu.querySelectorAll('.tour-menu-grid [data-tour]').forEach(b => { b.hidden = !lista.some(x => x.id === b.dataset.tour); });
    const s = lista.find(x => x.vista === vistaActiva());
    const aqui = menu.querySelector('[data-tour="aqui"]');
    aqui.hidden = !s;
    if (s) $('tourAquiNombre').textContent = s.titulo;
    const r = btnAyuda.getBoundingClientRect();
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.left = Math.max(8, Math.min(r.right - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8)) + 'px';
  }

  btnAyuda.addEventListener('click', (e) => { e.stopPropagation(); abrirMenu(menu.hidden); });
  menu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour]');
    if (!b) return;
    const id = b.dataset.tour;
    if (id === 'todo') empezar(disponibles());
    else if (id === 'aqui') empezar(disponibles().filter(s => s.vista === vistaActiva()));
    else empezar(disponibles().filter(s => s.id === id));
  });
  document.addEventListener('mousedown', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && !btnAyuda.contains(e.target)) abrirMenu(false);
  });

  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-tour-acc]');
    if (!b) return;
    if (b.dataset.tourAcc === 'cerrar') terminar();
    else mover(b.dataset.tourAcc === 'atras' ? -1 : 1);
  });
  // Durante el recorrido las teclas son del recorrido.
  document.addEventListener('keydown', (e) => {
    if (!menu.hidden && e.key === 'Escape') { abrirMenu(false); return; }
    if (capa.hidden) return;
    if (e.key === 'Escape') terminar();
    else if (e.key === 'ArrowRight' || e.key === 'Enter') mover(1);
    else if (e.key === 'ArrowLeft') mover(-1);
    else return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
  window.addEventListener('resize', () => { colocar(); if (!menu.hidden) abrirMenu(true); });
  document.addEventListener('scroll', () => requestAnimationFrame(colocar), true);

  // La primera vez, el botón de ayuda llama la atención (sin abrir nada).
  try { if (!localStorage.getItem(VISTO_KEY)) btnAyuda.classList.add('pulso'); } catch (err) { /* no crítico */ }

  window.rcTour = { empezar: (id) => empezar(id ? SECCIONES.filter(s => s.id === id) : SECCIONES), secciones: SECCIONES.map(s => s.id) };
})();
