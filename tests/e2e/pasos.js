(async () => {
  const log = [];
  try {
  const wait = (ms) => new Promise(r => setTimeout(r, ms || 150));
  const $ = (s) => document.querySelector(s);
  const check = (label, cond) => log.push((cond ? 'OK   ' : 'FALLA') + ' ' + label);
  const set = (id, value) => { const el = document.getElementById(id); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
  const submit = async () => { $('#mgmtForm').requestSubmit(); await wait(250); };
  const noticeText = () => $('#noticeOverlay').classList.contains('show') ? $('#noticeMessage').textContent : null;
  const okNotice = async () => { $('#noticeOkBtn').click(); await wait(); };

  document.getElementById('licenseGate').classList.add('gate-hidden');
  await wait(400);

  check('arranca en Resumen', document.body.dataset.activeView === 'resumen' && !$('[data-view="resumen"].view').hidden);
  check('acciones del redactor ocultas fuera del redactor', $('#btnSaveNow').offsetParent === null);
  check('menú lateral visible con 16 vistas', document.querySelectorAll('.nav-item[data-view]').length === 16);
  // Redactor sin documento: pantalla de inicio en lugar de una página vacía
  $('.nav-item[data-view="redactor"]').click(); await wait();
  check('redactor sin documento: pantalla de inicio con 3 opciones', !$('#rdEmpty').hidden && $('#editor').hidden && document.querySelectorAll('[data-rd-start]').length === 3);
  document.querySelector('[data-rd-start="texto"]').click(); await wait();
  check('"Cargar texto" desde la pantalla de inicio', $('#loadOverlay').classList.contains('show'));
  $('#loadCancel').click(); await wait();
  $('.nav-item[data-view="resumen"]').click(); await wait();

  // Edificio
  $('.nav-item[data-view="edificios"]').click(); await wait();
  check('vista Edificios activa', $('#viewTitle').textContent === 'Edificios');
  $('[data-view="edificios"] [data-new="edificio"]').click(); await wait();
  set('mf-nombre', 'Residencial Las Palmas');
  set('mf-direccion', 'Calle 5 #12, Santo Domingo');
  set('mf-propietarioNuevo', 'María Gómez');
  set('mf-cantidad', '6');
  set('mf-pisos', '2');
  await submit();
  check('edificio en la vista', $('#tableEdificios').textContent.includes('Residencial Las Palmas'));
  const tileIds = () => [...document.querySelectorAll('#tableEdificios .unit-tile:not(.tile-add) .tile-id')].map(e => e.textContent);
  check('crea 6 casillas por piso (201-203 arriba)', tileIds().join(',') === '201,202,203,101,102,103');
  check('etiquetas de piso', $('#tableEdificios').textContent.includes('Piso 2') && $('#tableEdificios').textContent.includes('Piso 1'));

  // Campo requerido vacío
  $('[data-view="edificios"] [data-new="edificio"]').click(); await wait();
  await submit();
  check('valida campo requerido', (noticeText() || '').includes('Nombre del edificio'));
  await okNotice();
  $('#mgmtFormCancel').click(); await wait();

  // Apartamento
  $('.nav-item[data-view="unidades"]').click(); await wait();
  $('[data-view="unidades"] [data-new="unidad"]').click(); await wait();
  const edfOpt = [...$('#mf-edificioId').options].find(o => o.value);
  set('mf-edificioId', edfOpt.value);
  set('mf-identificador', '3B');
  set('mf-renta', '25000');
  await submit();
  check('apartamento disponible', $('#tableUnidades').textContent.includes('3B') && $('#tableUnidades').textContent.includes('Disponible'));

  // Apartamento repetido
  $('[data-view="unidades"] [data-new="unidad"]').click(); await wait();
  set('mf-edificioId', edfOpt.value);
  set('mf-identificador', '3b');
  await submit();
  check('impide apartamento repetido', (noticeText() || '').includes('Ya existe'));
  await okNotice();
  $('#mgmtFormCancel').click(); await wait();

  // Inquilino
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  $('[data-view="inquilinos"] [data-new="inquilino"]').click(); await wait();
  set('mf-nombre', 'Juan Pérez');
  // Cédula: aviso en vivo si el dígito verificador no coincide
  set('mf-documento', '00112345678');
  check('cédula con dígito verificador incorrecto: aviso en vivo', $('#docchk-documento').textContent.includes('dígito verificador') && $('#docchk-documento').classList.contains('doc-invalida'));
  set('mf-documento', 'AB1234567');
  check('pasaporte: no se valida como cédula', $('#docchk-documento').textContent.includes('pasaporte'));
  set('mf-documento', '00112345678');
  set('mf-nacionalidad', 'dominicano');
  $('#mgmtForm').requestSubmit(); await wait(300);
  check('al guardar una cédula inválida pide confirmación', (noticeText() || '').includes('¿Guardar de todos modos?'));
  $('#noticeCancelBtn').click(); await wait();
  check('si no se confirma, el formulario sigue abierto', $('#mgmtFormOverlay').classList.contains('show'));
  set('mf-documento', '00112345673');
  check('cédula válida: aviso en verde con su formato', $('#docchk-documento').textContent.includes('✓ Cédula válida (001-1234567-3)'));
  await submit();
  check('inquilino en la tabla', $('#tableInquilinos').textContent.includes('Juan Pérez'));
  check('la cédula se guarda con su formato', $('#tableInquilinos').textContent.includes('001-1234567-3'));

  // Contrato desde "Alquilar"
  $('.nav-item[data-view="unidades"]').click(); await wait();
  [...document.querySelectorAll('#tableUnidades tr')].find(tr => tr.textContent.includes('3B')).querySelector('[data-act="alquilar"]').click(); await wait();
  check('monto propuesto desde la renta', $('#mf-monto').value === '25000');
  const inqOpt = [...$('#mf-inquilinoId').options].find(o => o.value);
  set('mf-inquilinoId', inqOpt.value);
  set('mf-fechaInicio', '2026-01-01');
  check('fecha de fin propuesta a un año', $('#mf-fechaFin').value === '2026-12-31');
  set('mf-deposito', '50000');
  await submit();
  check('apartamento pasa a Ocupado', $('#tableUnidades').textContent.includes('Ocupado') && $('#tableUnidades').textContent.includes('Juan Pérez'));

  // Segundo contrato sobre el mismo apartamento: no debe aparecer en la lista
  $('.nav-item[data-view="contratos"]').click(); await wait();
  $('[data-view="contratos"] [data-new="contrato"]').click(); await wait();
  check('apartamento ocupado no se ofrece', ![...$('#mf-unidadId').options].some(o => o.textContent.includes('3B')));
  $('#mgmtFormCancel').click(); await wait();

  // Casillas: aumentar, reducir y hacer clic
  $('.nav-item[data-view="edificios"]').click(); await wait();
  check('casilla 3B ocupada con nombre corto', !!document.querySelector('.unit-tile.tile-ocupado') && $('.unit-tile.tile-ocupado').textContent.includes('Juan P.'));
  $('#tableEdificios [data-act="editar-edificio"]').click(); await wait();
  check('formulario muestra la cantidad actual', $('#mf-cantidad').value === '7');
  set('mf-cantidad', '8');
  await submit();
  check('al aumentar crea el que falta (104)', tileIds().includes('104') && tileIds().length === 8);
  $('#tableEdificios [data-act="editar-edificio"]').click(); await wait();
  set('mf-cantidad', '5');
  $('#mgmtForm').requestSubmit(); await wait(250);
  check('pide confirmación al reducir', (noticeText() || '').includes('201, 202, 203'));
  await okNotice(); await wait(250);
  check('al reducir quita los libres del piso alto y conserva el ocupado', tileIds().length === 5 && tileIds().includes('3B') && !tileIds().includes('203'));
  $('#tableEdificios [data-act="editar-edificio"]').click(); await wait();
  set('mf-cantidad', '0');
  await submit();
  check('no reduce por debajo de los que tienen contrato', (noticeText() || '').includes('no se eliminan'));
  await okNotice();
  $('#mgmtFormCancel').click(); await wait();
  $('.unit-tile.tile-disponible').click(); await wait();
  check('clic en casilla libre abre nuevo contrato con ese apartamento', $('#mgmtFormOverlay').classList.contains('show') && $('#mgmtFormTitle').textContent === 'Nuevo contrato' && $('#mf-unidadId').selectedOptions[0].textContent.includes('Residencial'));
  $('#mgmtFormCancel').click(); await wait();
  $('.unit-tile.tile-ocupado').click(); await wait();
  check('clic en casilla ocupada abre la ficha del inquilino', $('#tenantDetailOverlay').classList.contains('show'));
  $('#tenantDetailClose').click(); await wait();
  $('.unit-tile .tile-edit').click(); await wait();
  check('lápiz de la casilla edita el apartamento', $('#mgmtFormTitle').textContent === 'Editar apartamento');
  $('#mgmtFormCancel').click(); await wait();
  $('.nav-item[data-view="contratos"]').click(); await wait();

  check('contrato en la tabla con estado', $('#tableContratos').textContent.includes('Juan Pérez') && $('#tableContratos .badge') !== null);

  // Resumen
  $('.nav-item[data-view="resumen"]').click(); await wait();
  check('ocupación 20% en resumen (1 de 5)', $('#dashStats').textContent.includes('20%'));
  check('alquiler mensual en resumen', $('#dashStats').textContent.includes('RD$'));
  check('contadores del menú', $('[data-count="contratos"]').textContent === '1');

  // Ficha del inquilino
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  $('#tableInquilinos [data-act="ver-inquilino"]').click(); await wait();
  check('ficha del inquilino con su contrato', $('#tenantDetailOverlay').classList.contains('show') && $('#tenantDetailBody').textContent.includes('Residencial Las Palmas · 3B'));
  $('#tenantDetailEdit').click(); await wait();
  check('formulario por encima de la ficha', Number(getComputedStyle($('#mgmtFormOverlay')).zIndex) > Number(getComputedStyle($('#tenantDetailOverlay')).zIndex));
  set('mf-telefono', '809-555-1234');
  await submit();
  check('ficha se actualiza al editar', $('#tenantDetailBody').textContent.includes('809-555-1234'));
  $('#tenantDetailClose').click(); await wait();

  // Modelo con campos -> documento del contrato
  localStorage.setItem('redactorContratos.plantillas.v1', JSON.stringify([{
    id: 'tpl-test', name: 'Contrato de prueba', savedAt: new Date().toISOString(),
    html: '<p>Yo, <span class="campo" id="c1" contenteditable="false" data-label="Nombre del inquilino" data-value="">[Nombre del inquilino]</span>, cédula <span class="campo" id="c2" contenteditable="false" data-label="Cédula" data-value="">[Cédula]</span>, alquilo el apto <span class="campo" id="c3" contenteditable="false" data-label="Apartamento" data-value="">[Apartamento]</span> por <span class="campo" id="c4" contenteditable="false" data-label="renta" data-value="">[renta]</span> desde el <span class="campo" id="c5" contenteditable="false" data-label="Fecha de inicio" data-value="">[Fecha de inicio]</span>. Arrendador: <span class="campo" id="c6" contenteditable="false" data-label="Arrendador" data-value="">[Arrendador]</span>. Otro: <span class="campo" id="c7" contenteditable="false" data-label="Campo libre" data-value="">[Campo libre]</span></p>'
  }]));
  $('.nav-item[data-view="contratos"]').click(); await wait();
  $('#tableContratos [data-act="documento"]').click(); await wait(500);
  check('migra el modelo antiguo a la carpeta y avisa', (noticeText() || '').includes('Modelos') && localStorage.getItem('redactorContratos.plantillas.v1') === null);
  await okNotice();
  check('selector de modelos abierto', $('#templatePickerOverlay').classList.contains('show') && $('#templatePickerList').textContent.includes('Contrato de prueba'));
  $('#templatePickerList [data-pick="tpl"]').click(); await wait(300);
  const text = $('#editor').textContent;
  check('cambia al redactor', document.body.dataset.activeView === 'redactor');
  check('rellena nombre, cédula y apartamento', text.includes('Juan Pérez') && text.includes('001-1234567-3') && text.includes('3B'));
  check('rellena renta, fecha y arrendador', text.includes('RD$') && text.includes('1 de enero de 2026') && text.includes('María Gómez'));
  check('deja sin tocar campos desconocidos', text.includes('[Campo libre]'));
  check('barra del contrato visible', !$('#contractLinkBar').hidden);
  check('acciones del redactor visibles', $('#btnSaveNow').offsetParent !== null);
  check('sugerencias de campos cargadas', $('#fieldLabelSuggestions').options.length > 10);

  $('#btnLinkSave').click(); await wait(300);
  check('documento guardado en el contrato', $('#contractLinkText').textContent.includes('guardado el'));
  $('.nav-item[data-view="contratos"]').click(); await wait();
  check('contrato muestra "Redactado"', $('#tableContratos').textContent.includes('Redactado'));

  // ---------- Redactor: carpeta de trabajo, documentos y modelos ----------
  $('.nav-item[data-view="redactor"]').click(); await wait();
  check('carpeta de trabajo visible en la cabecera', $('#folderName').textContent === 'trabajo' && !$('#btnOpenFolder').disabled);
  check('nada del redactor en la barra superior', !document.querySelector('.topbar #btnSaveNow, .topbar #baseName'));
  check('nombre del documento propuesto sin acentos', $('#baseName').value === 'contrato_Juan_Perez_3B');
  $('#btnSaveNow').click(); await wait(500);
  check('guarda .doc en la carpeta y lo lista', $('#folderFilesList').textContent.includes('contrato_Juan_Perez_3B_') && $('#libCountDocs').textContent === '1');
  $('#btnSaveTemplate').click(); await wait();
  $('#templateNameInput').value = 'Arrendamiento: estándar';
  $('#templateSaveConfirm').click(); await wait(500);
  check('guarda modelo en Modelos y cambia a la pestaña', $('[data-lib-tab="modelos"]').classList.contains('active') && $('#folderFilesList').textContent.includes('Arrendamiento- estándar') && $('#libCountModelos').textContent === '2');
  $('#btnSaveTemplate').click(); await wait();
  $('#templateNameInput').value = 'Arrendamiento: estándar';
  $('#templateSaveConfirm').click(); await wait(400);
  check('pide confirmar al reemplazar un modelo', (noticeText() || '').includes('Ya existe'));
  $('#noticeCancelBtn').click(); await wait(300);
  // Usar un modelo desde la biblioteca
  [...document.querySelectorAll('#folderFilesList .lib-item')].find(el => el.textContent.includes('Contrato de prueba')).querySelector('[data-lib="usar"]').click(); await wait();
  check('pide confirmar antes de reemplazar el documento', (noticeText() || '').includes('reemplazará'));
  await okNotice(); await wait(300);
  check('usa el modelo de la carpeta', $('#editor').textContent.includes('[Nombre del inquilino]'));
  // Abrir un documento guardado
  document.querySelector('[data-lib-tab="documentos"]').click(); await wait();
  document.querySelector('#folderFilesList [data-lib="abrir"]').click(); await wait();
  await okNotice(); await wait(300);
  check('abre el .doc guardado con sus campos', $('#editor').textContent.includes('Juan Pérez') && $('#editor .campo') !== null && $('#baseName').value === 'contrato_Juan_Perez_3B');
  // Búsqueda en la biblioteca
  set('folderFilesSearch', 'zzz');
  check('búsqueda en la biblioteca', $('#folderFilesList').textContent.includes('Ningún documento'));
  set('folderFilesSearch', '');
  $('.nav-item[data-view="contratos"]').click(); await wait();

  // Finalizar
  $('#tableContratos [data-act="finalizar"]').click(); await wait();
  $('#noticeOkBtn').click(); await wait(300);
  check('contrato finalizado', $('#tableContratos').textContent.includes('Finalizado'));
  $('.nav-item[data-view="unidades"]').click(); await wait();
  check('apartamento vuelve a Disponible', $('#tableUnidades').textContent.includes('Disponible'));

  // Borrado protegido
  [...document.querySelectorAll('#tableUnidades tr')].find(tr => tr.textContent.includes('3B')).querySelector('[data-act="borrar-unidad"]').click(); await wait();
  check('no deja borrar apartamento con historial', (noticeText() || '').includes('historial'));
  await okNotice();

  // ---------- Finanzas ----------
  const hoy = new Date();
  const mesActual = hoy.getFullYear() + '-' + String(hoy.getMonth() + 1).padStart(2, '0');
  $('.nav-item[data-view="cobros"]').click(); await wait();
  check('cobros abre en el mes actual', $('#cobrosMes').value === mesActual);
  check('cuota del mes atrasada', $('#cobrosCuotas').textContent.includes('Juan Pérez') && $('#cobrosCuotas').textContent.includes('Atrasado'));
  check('deuda acumulada de 10 meses', $('#cobrosCuotas').textContent.includes('250,000.00') && $('#cobrosCuotas').textContent.includes('10 meses'));
  check('menú marca 1 contrato atrasado', $('[data-count="atrasados"]').textContent === '1');
  $('#cobrosCuotas [data-act="pagar"]').click(); await wait();
  check('pago propone el saldo', $('#mf-monto').value === '25000' && $('#mf-periodo').value === mesActual);
  check('pago muestra la cuota', ($('#pagoHint').textContent || '').includes('saldo'));
  set('mf-referencia', 'TRX-001');
  await submit();
  check('cuota pasa a Pagado', $('#cobrosCuotas').textContent.includes('Pagado'));
  check('pago listado con recibo No. 00001', $('#cobrosPagos').textContent.includes('No. 00001'));
  // Abono parcial al mes anterior
  $('#cobrosPrev').click(); await wait();
  $('#cobrosCuotas [data-act="pagar"]').click(); await wait();
  set('mf-monto', '10000');
  await submit();
  check('abono parcial atrasado', $('#cobrosCuotas').textContent.includes('Parcial · atrasado'));
  // Pago fuera del contrato pide confirmación
  $('[data-view="cobros"] [data-new="pago"]').click(); await wait();
  set('mf-contratoId', [...$('#mf-contratoId').options].find(o => o.value).value);
  set('mf-periodo', '2030-01');
  check('aviso de mes fuera del contrato', ($('#pagoHint').textContent || '').includes('no cubre'));
  set('mf-monto', '5');
  $('#mgmtForm').requestSubmit(); await wait(250);
  check('confirma pago fuera del contrato', (noticeText() || '').includes('no cubre'));
  $('#noticeCancelBtn').click(); await wait();
  $('#mgmtFormCancel').click(); await wait();
  // Recibo
  $('#cobrosNext').click(); await wait();
  $('#cobrosPagos [data-act="recibo"]').click(); await wait(400);
  // Contrato con pagos no se puede borrar
  $('.nav-item[data-view="contratos"]').click(); await wait();
  $('#tableContratos [data-act="borrar-contrato"]').click(); await wait();
  check('no deja borrar contrato con pagos', (noticeText() || '').includes('pagos registrados') || (noticeText() || '').includes('pago registrado'));
  await okNotice();

  // Gastos
  $('.nav-item[data-view="gastos"]').click(); await wait();
  $('[data-view="gastos"] [data-new="gasto"]').click(); await wait();
  set('mf-categoria', 'Electricidad');
  set('mf-descripcion', 'Luz áreas comunes');
  set('mf-monto', '3500');
  set('mf-proveedor', 'Edesur');
  await submit();
  $('[data-view="gastos"] [data-new="gasto"]').click(); await wait();
  check('opciones de apartamento según edificio', [...$('#mf-unidadId').options].some(o => o.textContent === 'Apartamento 101'));
  set('mf-unidadId', [...$('#mf-unidadId').options].find(o => o.textContent === 'Apartamento 101').value);
  set('mf-categoria', 'Reparación');
  set('mf-descripcion', 'Cambio de llave de agua');
  set('mf-monto', '8000');
  await submit();
  check('gastos en la tabla', $('#gastosTabla').textContent.includes('Luz áreas comunes') && $('#gastosTabla').textContent.includes('Apartamento 101') && $('#gastosTabla').textContent.includes('Áreas comunes'));
  check('total de gastos', $('#gastosStats').textContent.includes('11,500.00'));
  [...document.querySelectorAll('#gastosTabla tr')].find(tr => tr.textContent.includes('Luz')).querySelector('[data-act="duplicar-gasto"]').click(); await wait();
  check('repetir gasto copia los datos', $('#mf-descripcion').value === 'Luz áreas comunes' && $('#mf-monto').value === '3500' && $('#mgmtFormTitle').textContent === 'Nuevo gasto');
  $('#mgmtFormCancel').click(); await wait();
  set('gastosCategoria', 'Reparación');
  check('filtro por categoría', !$('#gastosTabla').textContent.includes('Luz') && $('#gastosTabla').textContent.includes('llave'));
  set('gastosCategoria', '');

  // Balance
  $('.nav-item[data-view="balance"]').click(); await wait();
  check('balance: ingresos 35,000', $('#balanceStats').textContent.includes('35,000.00'));
  check('balance: neto 23,500', $('#balanceStats').textContent.includes('23,500.00'));
  check('gráfico con 12 meses', document.querySelectorAll('#balanceChart .chart-group').length === 12);
  const grupoMes = document.querySelectorAll('#balanceChart .chart-group')[hoy.getMonth()];
  grupoMes.dispatchEvent(new MouseEvent('mouseenter'));
  await wait();
  check('tooltip del mes', !$('#balanceChart .chart-tip').hidden && $('#balanceChart .chart-tip').textContent.includes('35,000.00'));
  check('gastos por categoría', $('#balanceCategorias').textContent.includes('Reparación') && $('#balanceCategorias').textContent.includes('Electricidad'));
  check('tabla mensual con total', $('#balanceTabla').textContent.includes('Total'));

  // Resumen y ficha
  $('.nav-item[data-view="resumen"]').click(); await wait();
  check('resumen avisa del pago atrasado', $('#dashAlerts').textContent.includes('Pago atrasado'));
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  $('#tableInquilinos [data-act="ver-inquilino"]').click(); await wait();
  check('ficha muestra deuda y pagos', $('#tenantDetailBody').textContent.includes('Debe') && $('#tenantDetailBody').textContent.includes('No. 00002'));
  $('#tenantDetailClose').click(); await wait();

  // ---------- Propietarios y liquidaciones ----------
  $('.nav-item[data-view="propietarios"]').click(); await wait();
  check('propietario creado desde el edificio', $('#tablePropietarios').textContent.includes('María Gómez') && $('#tablePropietarios').textContent.includes('5 apartamentos'));
  $('#tablePropietarios [data-act="editar-propietario"]').click(); await wait();
  check('el propietario ya no lleva comisión', !$('#mf-comisionValor'));
  set('mf-cuenta', '123-456789-0');
  set('mf-banco', 'Banco Popular');
  await submit();
  check('cuenta del propietario', $('#tablePropietarios').textContent.includes('123-456789-0'));
  // La comisión del abogado se define en el edificio
  $('.nav-item[data-view="edificios"]').click(); await wait();
  $('#tableEdificios [data-act="editar-edificio"]').click(); await wait();
  set('mf-comisionTipo', 'porcentaje');
  set('mf-comisionValor', '10');
  await submit();
  check('comisión del abogado en el edificio', $('#tableEdificios').textContent.includes('Comisión: 10% de lo cobrado'));
  $('.nav-item[data-view="propietarios"]').click(); await wait();
  $('[data-view="propietarios"] [data-new="propietario"]').click(); await wait();
  set('mf-nombre', 'Pedro Dueño');
  // Propietario empresa: RNC (el de la DGII, válido) se acepta y se formatea
  set('mf-documento', '401506254');
  check('RNC válido reconocido', $('#docchk-documento').textContent.includes('✓ RNC válido (4-01-50625-4)'));
  await submit();
  check('el RNC se guarda con su formato', $('#tablePropietarios').textContent.includes('4-01-50625-4'));
  // El apartamento 101 es de otro propietario
  $('.nav-item[data-view="unidades"]').click(); await wait();
  [...document.querySelectorAll('#tableUnidades tr')].find(tr => tr.textContent.includes('· 101') || tr.querySelector('.cell-main') && tr.querySelector('.cell-main').textContent === '101').querySelector('[data-act="editar-unidad"]').click(); await wait();
  set('mf-propietarioId', [...$('#mf-propietarioId').options].find(o => o.textContent === 'Pedro Dueño').value);
  // y no lleva comisión: la suya reemplaza la del edificio
  set('mf-comisionTipo', 'ninguna');
  await submit();
  $('.nav-item[data-view="propietarios"]').click(); await wait();
  check('apartamento suelto cuenta para su propietario', [...document.querySelectorAll('#tablePropietarios tr')].find(tr => tr.textContent.includes('Pedro Dueño')).textContent.includes('1 apartamento'));
  $('#tablePropietarios [data-act="borrar-propietario"]').click(); await wait();
  check('no deja borrar propietario con inmuebles', (noticeText() || '').includes('asignado'));
  await okNotice();

  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  check('liquidaciones abre en el mes anterior', $('#liqMes').value !== mesActual);
  $('#liqNext').click(); await wait();
  const filaMaria = () => [...document.querySelectorAll('#liqTabla tbody tr')].find(tr => tr.textContent.includes('María Gómez'));
  const filaPedro = () => [...document.querySelectorAll('#liqTabla tbody tr')].find(tr => tr.textContent.includes('Pedro Dueño'));
  check('María: cobrado 35,000, gastos 3,500, comisión 3,500, neto 28,000', filaMaria() && ['35,000.00', '3,500.00', '28,000.00'].every(s => filaMaria().textContent.includes(s)));
  check('Pedro: gasto del 101 a su cargo', filaPedro() && filaPedro().textContent.includes('8,000.00') && filaPedro().textContent.includes('A cargo del propietario'));
  check('tu comisión', $('#liqStats').textContent.includes('Tu comisión') && $('#liqStats').textContent.includes('3,500.00'));
  check('la fila es del edificio, con desglose por apartamento', filaMaria().textContent.includes('Residencial Las Palmas') && !!filaMaria().querySelector('.liq-desglose li') &&
    filaMaria().querySelector('.liq-desglose').textContent.includes('10% de lo cobrado'));
  // Descontar gastos se configura por edificio
  $('.nav-item[data-view="configuracion"]').click(); await wait(300);
  const chkGastos = document.querySelector('[data-cfg-gastos]');
  check('opción de descontar gastos por edificio en Configuración', !!chkGastos && chkGastos.checked && chkGastos.closest('label').textContent.includes('Residencial Las Palmas'));
  chkGastos.checked = false; chkGastos.dispatchEvent(new Event('change', { bubbles:true })); await wait(300);
  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  check('sin descontar gastos: neto 31,500 y Pedro sin cargo', filaMaria().textContent.includes('No se descuentan') && filaMaria().textContent.includes('31,500.00') && !filaPedro());
  $('.nav-item[data-view="configuracion"]').click(); await wait(300);
  const chkGastos2 = document.querySelector('[data-cfg-gastos]');
  check('la opción queda guardada', !chkGastos2.checked);
  chkGastos2.checked = true; chkGastos2.dispatchEvent(new Event('change', { bubbles:true })); await wait(300);
  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  filaMaria().querySelector('[data-act="estado-cuenta"]').click(); await wait(400);
  filaMaria().querySelector('[data-act="registrar-liquidacion"]').click(); await wait();
  check('transferencia propone el neto', $('#mf-monto').value === '28000' && $('#mgmtFormSub').textContent.includes('123-456789-0'));
  set('mf-referencia', 'TRF-777');
  await submit();
  check('liquidación registrada', filaMaria().textContent.includes('Liquidado'));
  // "Todo": todas las liquidaciones de todos los meses, con su mes
  const mesLiq = $('#liqMes').value;
  const filasDelMes = document.querySelectorAll('#liqTabla tbody tr').length;
  document.querySelector('[data-liq-modo="todo"]').click(); await wait();
  const filasTodo = () => [...document.querySelectorAll('#liqTabla tbody tr')];
  check('modo Todo: lista con columna Mes y sin selector de mes', $('#liqMesControles').hidden && $('#btnEnvioEstados').hidden && $('#liqTitulo').textContent.startsWith('Todas las liquidaciones') &&
    $('#liqTabla thead').textContent.startsWith('Mes') && filasTodo().length >= 2 && filasTodo().some(tr => tr.textContent.includes('María Gómez') && tr.textContent.includes('Liquidado')));
  const mesesTodo = filasTodo().map(tr => tr.querySelector('.liq-mes').textContent);
  check('incluye todas las del mes (y las de otros meses)', filasTodo().length >= filasDelMes && mesesTodo.length === filasTodo().length);
  set('liqEstado', 'pendientes'); await wait();
  check('filtro "Pendientes": quita las registradas', filasTodo().length > 0 && filasTodo().every(tr => !tr.textContent.includes('Liquidado')));
  // Imprimir y registrar funcionan desde Todo (la fila sabe su mes)
  const filaPendTodo = filasTodo().find(tr => tr.querySelector('[data-act="registrar-liquidacion"]'));
  const mesFilaPend = filaPendTodo.querySelector('.liq-mes').textContent;
  filaPendTodo.querySelector('[data-act="registrar-liquidacion"]').click(); await wait();
  check('registrar desde Todo usa el mes de la fila', $('#mgmtFormSub').textContent.includes(mesFilaPend));
  $('#mgmtFormCancel').click(); await wait();
  set('liqEstado', 'registradas'); await wait();
  check('filtro "Registradas"', filasTodo().length > 0 && filasTodo().every(tr => !!tr.querySelector('[data-act="anular-liquidacion"]')));
  set('liqEstado', ''); await wait();
  document.querySelector('[data-liq-modo="mes"]').click(); await wait();
  check('vuelve a "Por mes" en el mismo mes', !$('#liqMesControles').hidden && $('#liqMes').value === mesLiq && !!filaMaria());
  // Un pago nuevo después de registrar: avisa la diferencia
  $('.nav-item[data-view="cobros"]').click(); await wait();
  $('#cobrosPrev').click(); $('#cobrosPrev').click(); await wait();
  $('#cobrosCuotas [data-act="pagar"]').click(); await wait();
  set('mf-monto', '1000');
  await submit();
  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  check('avisa si cambió después de registrar', filaMaria().textContent.includes('Cambió'));
  filaMaria().querySelector('[data-act="anular-liquidacion"]').click(); await wait();
  await okNotice(); await wait(300);
  check('anular deja pendiente', filaMaria().textContent.includes('Pendiente'));

  // Un registro sigue visible aunque desaparezcan sus movimientos
  filaPedro().querySelector('[data-act="registrar-liquidacion"]').click(); await wait();
  await submit();
  check('cobro al propietario registrado', filaPedro().textContent.includes('Cobrado'));
  $('.nav-item[data-view="gastos"]').click(); await wait();
  [...document.querySelectorAll('#gastosTabla tbody tr')].find(tr => tr.textContent.includes('llave')).querySelector('[data-act="borrar-gasto"]').click(); await wait();
  await okNotice(); await wait(300);
  $('.nav-item[data-view="unidades"]').click(); await wait();
  [...document.querySelectorAll('#tableUnidades tr')].find(tr => tr.querySelector('.cell-main') && tr.querySelector('.cell-main').textContent === '101').querySelector('[data-act="editar-unidad"]').click(); await wait();
  set('mf-propietarioId', '');
  set('mf-comisionTipo', '');
  await submit();
  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  check('sin movimientos, el registro sigue visible y avisa la diferencia', !!filaPedro() && filaPedro().textContent.includes('Cobrado') && filaPedro().textContent.includes('Cambió') && !!filaPedro().querySelector('[data-act="anular-liquidacion"]'));
  // Al intentar eliminar al propietario: dice el mes y lleva a la liquidación
  $('.nav-item[data-view="propietarios"]').click(); await wait();
  [...document.querySelectorAll('#tablePropietarios tbody tr')].find(tr => tr.textContent.includes('Pedro Dueño')).querySelector('[data-act="borrar-propietario"]').click(); await wait();
  const mesNombre = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'][hoy.getMonth()] + ' ' + hoy.getFullYear();
  check('eliminar propietario con liquidación: dice el mes', (noticeText() || '').includes(mesNombre) && (noticeText() || '').includes('anúlala'));
  await okNotice(); await wait(300);
  check('lleva a Liquidaciones filtrado por ese propietario', document.body.dataset.activeView === 'liquidaciones' && $('#liqPropietario').selectedOptions[0].textContent === 'Pedro Dueño' && !!filaPedro() && !filaMaria());
  filaPedro().querySelector('[data-act="anular-liquidacion"]').click(); await wait();
  await okNotice(); await wait(300);
  check('anulado, el propietario ya no tiene registros', !filaPedro());
  set('liqPropietario', ''); await wait();

  // Respaldo automático
  check('respaldo de hoy en el menú', !$('#backupStatus').hidden && $('#backupStatusText').textContent.startsWith('Hoy'));

  // ---------- Ciclo del contrato: varios inquilinos, fiador, mora ----------
  const pad2 = (n) => String(n).padStart(2, '0');
  const primerDia = (offset) => { const d = new Date(hoy.getFullYear(), hoy.getMonth() + offset, 1); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-01'; };
  const mesVencido = hoy.getDate() > 6; // día de pago 1 + 5 días de gracia
  const hoyStr = hoy.getFullYear() + '-' + pad2(hoy.getMonth() + 1) + '-' + pad2(hoy.getDate());
  const MESES = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const inicioNuevo = new Date(hoy.getFullYear(), hoy.getMonth() - 4, 1);
  const desdeNuevo = 'desde ' + MESES[inicioNuevo.getMonth()] + ' ' + inicioNuevo.getFullYear();
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  $('[data-view="inquilinos"] [data-new="inquilino"]').click(); await wait();
  set('mf-nombre', 'Ana Rodríguez');
  set('mf-documento', '40200000004');
  await submit();
  $('.nav-item[data-view="unidades"]').click(); await wait();
  [...document.querySelectorAll('#tableUnidades tr')].find(tr => tr.textContent.includes('3B')).querySelector('[data-act="alquilar"]').click(); await wait();
  set('mf-inquilinoId', [...$('#mf-inquilinoId').options].find(o => o.textContent.startsWith('Juan')).value);
  [...document.querySelectorAll('[name="cotitulares"]')].find(x => x.parentElement.textContent.includes('Ana')).checked = true;
  set('mf-fechaInicio', primerDia(-4));
  set('mf-monto', '20000');
  set('mf-deposito', '40000');
  set('mf-moraTipo', 'porcentaje');
  set('mf-moraValor', '10');
  set('mf-moraGracia', '5');
  set('mf-fiadorNombre', 'Luis Fiador');
  await submit();
  const filaNueva = () => [...document.querySelectorAll('#tableContratos tbody tr')].find(tr => tr.textContent.includes('Ana Rodríguez') && !tr.textContent.includes('Renovado'));
  $('.nav-item[data-view="contratos"]').click(); await wait();
  check('contrato con dos inquilinos', !!filaNueva() && filaNueva().textContent.includes('y Ana Rodríguez'));
  check('depósito sin recibir', filaNueva().textContent.includes('sin recibir'));
  check('acciones secundarias en el menú ⋯', !!filaNueva().querySelector('[data-menu]') && filaNueva().querySelector('.row-menu').hidden);
  filaNueva().querySelector('[data-menu]').click(); await wait();
  check('el menú se abre', !filaNueva().querySelector('.row-menu').hidden);
  document.body.click(); await wait();

  // Recargo por mora y condonación
  $('.nav-item[data-view="cobros"]').click(); await wait();
  set('cobrosMes', primerDia(-1).slice(0, 7)); await wait();
  const filaCuota =() => [...document.querySelectorAll('#cobrosCuotas tbody tr')].find(tr => tr.textContent.includes('3B') && !tr.textContent.includes('25,000'));
  check('cuota vencida con recargo del 10%' + (filaCuota() ? '' : ' (no hay fila)'), !!filaCuota() && filaCuota().textContent.includes('22,000.00') && filaCuota().textContent.includes('incluye recargo RD$ 2,000.00'));
  filaCuota().querySelector('[data-act="condonar-recargo"]').click(); await wait();
  await okNotice(); await wait(300);
  check('recargo condonado', filaCuota().textContent.includes('recargo condonado') && !filaCuota().textContent.includes('22,000.00'));
  // 3 meses con recargo + el anterior condonado + el actual si ya venció (con recargo pasada la gracia).
  const deudaEsperada = 3 * 22000 + 20000 + (hoy.getDate() > 1 ? (mesVencido ? 22000 : 20000) : 0);
  const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2 });

  // Reportes: morosidad por antigüedad
  $('.nav-item[data-view="reportes"]').click(); await wait();
  const filaMora = (total) => [...document.querySelectorAll('#repMorosidad tbody tr')].find(tr => tr.textContent.includes('3B') && tr.textContent.includes(fmt(total)));
  check('morosidad por antigüedad con el total', !!filaMora(deudaEsperada) && filaMora(deudaEsperada).textContent.includes(desdeNuevo));
  check('tramo de más de 90 días', [...filaMora(deudaEsperada).querySelectorAll('td')][4].textContent.trim() !== '—');

  // Recordatorio (WhatsApp interceptado en la prueba)
  $('.nav-item[data-view="contratos"]').click(); await wait();
  filaNueva().querySelector('[data-act="recordar"]').click(); await wait();
  check('recordatorio con deuda y WhatsApp', $('#reminderOverlay').classList.contains('show') && $('#reminderText').value.includes(fmt(deudaEsperada)) && $('#reminderContacts').textContent.includes('+18095551234'));
  $('#reminderWhatsApp').click(); await wait(400);
  $('#reminderClose').click(); await wait();

  // Estado de cuenta del inquilino
  filaNueva().querySelector('[data-act="estado-cuenta-inquilino"]').click(); await wait(400);

  // Depósito: recibir, validar y liquidar aplicando lo retenido a la deuda
  filaNueva().querySelector('[data-act="deposito"]').click(); await wait();
  set('mf-fechaRecibido', primerDia(-4));
  await submit();
  check('depósito en custodia', filaNueva().textContent.includes('40,000.00 en custodia'));
  filaNueva().querySelector('[data-act="deposito"]').click(); await wait();
  set('mf-fechaLiquidacion', hoyStr);
  set('mf-devuelto', '10000');
  set('mf-retenido', '30000');
  await submit();
  check('pide motivo de la retención', (noticeText() || '').includes('motivo'));
  await okNotice();
  set('mf-motivo', 'Daños en la cocina');
  $('#mf-aplicarDeuda').checked = true;
  await submit();
  check('depósito liquidado', filaNueva().textContent.includes('liquidado: devuelto RD$ 10,000.00, retenido RD$ 30,000.00'));
  $('.nav-item[data-view="reportes"]').click(); await wait();
  check('lo retenido se aplicó a la deuda', !!filaMora(deudaEsperada - 30000));

  // Renovación (el apartamento ocupado impide renovar el contrato viejo)
  $('.nav-item[data-view="contratos"]').click(); await wait();
  const filaVieja = [...document.querySelectorAll('#tableContratos tbody tr')].find(tr => !tr.textContent.includes('Ana'));
  filaVieja.querySelector('[data-act="renovar"]').click(); await wait();
  await submit();
  check('no renueva si el apartamento tiene otro contrato activo', (noticeText() || '').includes('otro contrato activo'));
  await okNotice();
  $('#mgmtFormCancel').click(); await wait();
  filaNueva().querySelector('[data-act="renovar"]').click(); await wait();
  set('mf-aumento', '10');
  check('renovación calcula el aumento', $('#mf-monto').value === '22000');
  await submit();
  await okNotice();
  const filasAna = [...document.querySelectorAll('#tableContratos tbody tr')].filter(tr => tr.textContent.includes('Ana Rodríguez'));
  check('renovación crea un contrato nuevo y marca el anterior', filasAna.length === 2 && filasAna.some(tr => tr.textContent.includes('Renovación') && tr.textContent.includes('22,000.00')) && filasAna.some(tr => tr.textContent.includes('Renovado')));
  check('el nuevo no hereda el depósito ya devuelto', filasAna.find(tr => tr.textContent.includes('Renovación')).textContent.includes('sin recibir'));

  // Expediente: notas y archivos
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  [...document.querySelectorAll('#tableInquilinos [data-act="ver-inquilino"]')].find(b => b.textContent === 'Juan Pérez').click(); await wait(300);
  check('el recordatorio quedó en el seguimiento', $('#tenantDetailBody').textContent.includes('Recordatorio de pago enviado por WhatsApp'));
  $('#notaTexto').value = 'Llamó para acordar un plan de pagos';
  $('#tenantDetailBody [data-act="nota-agregar"]').click(); await wait(300);
  check('nota añadida', $('#tenantDetailBody').textContent.includes('Llamó para acordar un plan de pagos'));
  $('#tenantDetailBody [data-act="exp-adjuntar"]').click(); await wait(600);
  check('archivo adjuntado al expediente', $('#expFiles').textContent.includes('cedula-escaneada.txt'));
  check('ficha con contratos de cotitular', $('#tenantDetailBody').textContent.includes('3B'));
  $('#tenantDetailClose').click(); await wait();

  // Exportar a Excel (el diálogo de guardar se intercepta en la prueba)
  $('.nav-item[data-view="reportes"]').click(); await wait();
  $('[data-view="reportes"] [data-act="exportar-excel"]').click(); await wait(600);
  check('exporta el libro de Excel', $('#repExportStatus').textContent.includes('Guardado'));

  // Variables nuevas en el documento
  check('sugerencias con fiador y todos los inquilinos', [...$('#fieldLabelSuggestions').options].some(o => o.value === 'Nombre del fiador') && [...$('#fieldLabelSuggestions').options].some(o => o.value === 'Todos los inquilinos'));

  // Versión de la app en la marca (en la prueba Electron informa la suya;
  // con "npm start" o instalada es la del package.json).
  check('versión en la marca', /^R\d+\.\d+\.\d+$/.test($('#appVersion').textContent));

  // ---------- Pago de varios meses juntos ----------
  // Contrato original de Juan (25,000 al mes): enero a julio sin pagar.
  $('.nav-item[data-view="cobros"]').click(); await wait();
  const filaJuan = () => [...document.querySelectorAll('#cobrosCuotas tbody tr')].find(tr => tr.textContent.includes('Juan Pérez') && tr.textContent.includes('25,000'));
  set('cobrosMes', '2026-01'); await wait();
  filaJuan().querySelector('[data-act="pagar"]').click(); await wait();
  check('casilla de repartir marcada por defecto', $('#mf-repartir') && $('#mf-repartir').checked);
  set('mf-monto', '75000'); await wait();
  check('muestra el reparto antes de guardar', ['enero 2026 RD$ 25,000.00', 'febrero 2026 RD$ 25,000.00', 'marzo 2026 RD$ 25,000.00'].every(s => $('#pagoReparto').textContent.includes(s)));
  set('mf-referencia', 'TRX-3MESES');
  await submit();
  const filaPagoGrupo = () => [...document.querySelectorAll('#cobrosPagos tbody tr')].find(tr => tr.textContent.includes('TRX-3MESES') || tr.textContent.includes('GRP-EDITADO'));
  check('un solo pago de 3 meses en la tabla', !!filaPagoGrupo() && filaPagoGrupo().textContent.includes('enero 2026 – marzo 2026') && filaPagoGrupo().textContent.includes('3 meses') && filaPagoGrupo().textContent.includes('75,000.00'));
  set('cobrosMes', '2026-02'); await wait();
  check('febrero queda pagado', filaJuan().textContent.includes('Pagado'));
  check('el pago aparece también en febrero', !!filaPagoGrupo());
  filaPagoGrupo().querySelector('[data-act="recibo"]').click(); await wait(400);
  filaPagoGrupo().querySelector('[data-act="editar-pago"]').click(); await wait();
  check('editar un pago de varios meses solo cambia sus datos comunes', $('#mgmtFormSub').textContent.includes('elimina el pago') && !$('#mf-monto'));
  set('mf-referencia', 'GRP-EDITADO');
  await submit();
  check('la edición se aplica a todo el pago', filaPagoGrupo().textContent.includes('GRP-EDITADO'));
  filaPagoGrupo().querySelector('[data-act="borrar-pago"]').click(); await wait();
  check('eliminar avisa que borra el pago completo', (noticeText() || '').includes('se eliminará completo'));
  await okNotice(); await wait(300);
  check('al eliminarlo los tres meses vuelven a quedar pendientes', !filaPagoGrupo() && filaJuan().textContent.includes('Atrasado'));
  // Más dinero que deuda: avisa antes de registrarlo como adelantado
  set('cobrosMes', '2026-09'); await wait();
  filaJuan().querySelector('[data-act="pagar"]').click(); await wait();
  set('mf-monto', '20000'); await wait();
  check('el reparto avisa del sobrante', $('#pagoReparto').textContent.includes('sobran RD$ 5,000.00'));
  $('#mgmtForm').requestSubmit(); await wait(300);
  check('pide confirmar el pago mayor que la deuda', (noticeText() || '').includes('sobran RD$ 5,000.00'));
  $('#noticeCancelBtn').click(); await wait();
  $('#mgmtFormCancel').click(); await wait();

  // ---------- PIN de acceso ----------
  check('sin PIN no hay botón de bloquear', $('#btnLockNow').hidden);
  $('#btnPinSettings').click(); await wait();
  $('#pinNew').value = '1234';
  $('#pinNew2').value = '4321';
  $('#pinSetupSave').click(); await wait(600);
  check('PIN: avisa si no coinciden', (noticeText() || '').includes('no coinciden'));
  await okNotice();
  $('#pinNew2').value = '1234';
  $('#pinSetupSave').click(); await wait(800);
  await okNotice();
  check('PIN guardado sin guardar el PIN en claro', !$('#btnLockNow').hidden && !localStorage.getItem('renthouse.pin').includes('1234'));
  $('#btnLockNow').click(); await wait();
  check('bloquea la aplicación', !$('#pinLock').hidden && document.querySelector('.app-shell').inert);
  $('#pinLockInput').value = '9999';
  $('#pinLockBtn').click(); await wait(800);
  check('PIN incorrecto no desbloquea', !$('#pinLock').hidden && $('#pinLockStatus').textContent.includes('incorrecto'));
  $('#pinLockInput').value = '1234';
  $('#pinLockBtn').click(); await wait(800);
  check('PIN correcto desbloquea', $('#pinLock').hidden && !document.querySelector('.app-shell').inert);
  localStorage.setItem('rc_license_key', 'CLAVE-PRUEBA');
  $('#btnLockNow').click(); await wait();
  $('#pinForgot').click();
  $('#pinLockInput').value = 'CLAVE-PRUEBA';
  $('#pinLockBtn').click(); await wait(500);
  check('la clave de licencia desbloquea y quita el PIN', $('#pinLock').hidden && localStorage.getItem('renthouse.pin') === null);
  await okNotice();

  // ---------- Autocompletar por documento ----------
  const sug = (campo) => ($('#docsug-' + campo) || {}).textContent || '';
  // Un propietario con la cédula de un inquilino ya registrado: se rellena solo
  $('.nav-item[data-view="propietarios"]').click(); await wait();
  $('[data-view="propietarios"] [data-new="propietario"]').click(); await wait();
  set('mf-documento', '00112345673'); await wait(300);
  check('con el nombre vacío se rellena solo desde tus registros', $('#mf-nombre').value === 'Juan Pérez' && sug('documento').includes('Completado con los datos de inquilino: Juan Pérez'));
  $('#docsug-documento [data-autofill-deshacer]').click(); await wait();
  check('"Deshacer" quita lo completado', $('#mf-nombre').value === '' && sug('documento').includes('Se quitaron'));
  // Si ya hay algo escrito, no lo pisa: pregunta con un botón
  set('mf-nombre', 'Nombre escrito a mano');
  set('mf-documento', '00112345673'); await wait(400);
  check('con el nombre ya escrito, pregunta antes de reemplazarlo', $('#mf-nombre').value === 'Nombre escrito a mano' && sug('documento').includes('Registrado como inquilino: Juan Pérez') && !!$('#docsug-documento [data-autofill]'));
  $('#docsug-documento [data-autofill]').click(); await wait();
  check('"Usar sus datos" lo reemplaza', $('#mf-nombre').value === 'Juan Pérez');
  $('#mgmtFormCancel').click(); await wait();
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  $('[data-view="inquilinos"] [data-new="inquilino"]').click(); await wait();
  set('mf-documento', '00100000009'); await wait(400);
  check('cédula que no está en tus registros: lo dice', $('#mf-nombre').value === '' && sug('documento').includes('No está en tus registros. Completa los datos a mano.'));
  check('ya no existe el listado de la DGII', !document.getElementById('dgiiOverlay') && !window.rcDgii && !document.querySelector('[data-dgii-open]'));
  // Propios registros: otro inquilino con el mismo documento solo avisa
  set('mf-documento', '402-0000000-4'); await wait(300);
  check('mismo documento que otro inquilino: solo avisa', sug('documento').includes('Ya hay un inquilino con este documento: Ana Rodríguez') && !$('#docsug-documento [data-autofill]') && $('#mf-nombre').value === '');
  $('#mgmtFormCancel').click(); await wait();
  // Al editar un registro existente no aparecen avisos de "no encontrado"
  [...document.querySelectorAll('#tableInquilinos [data-act="ver-inquilino"]')].find(b => b.textContent === 'Juan Pérez').click(); await wait(300);
  $('#tenantDetailEdit').click(); await wait(400);
  check('al editar un registro no muestra avisos de autocompletar', sug('documento') === '');
  $('#mgmtFormCancel').click(); await wait();
  $('#tenantDetailClose').click(); await wait();
  // Un inquilino que pasa a ser propietario: se rellenan sus datos
  $('.nav-item[data-view="propietarios"]').click(); await wait();
  $('[data-view="propietarios"] [data-new="propietario"]').click(); await wait();
  set('mf-documento', '00112345673'); await wait(300);
  check('documento de un inquilino: se rellenan nombre y teléfono', sug('documento').includes('Completado con los datos de inquilino: Juan Pérez') && $('#mf-nombre').value === 'Juan Pérez' && $('#mf-telefono').value === '809-555-1234');
  $('#mgmtFormCancel').click(); await wait();
  // Fiador que ya es inquilino (si el contrato ya tenía fiador, pregunta antes)
  $('.nav-item[data-view="contratos"]').click(); await wait();
  document.querySelector('#tableContratos [data-act="editar-contrato"]').click(); await wait();
  set('mf-fiadorDocumento', '40200000004'); await wait(300);
  if ($('#docsug-fiadorDocumento [data-autofill]')) { $('#docsug-fiadorDocumento [data-autofill]').click(); await wait(); }
  check('fiador que ya es inquilino: se usan sus datos', $('#mf-fiadorNombre').value === 'Ana Rodríguez' && sug('fiadorDocumento').includes('Ana Rodríguez'));
  $('#mgmtFormCancel').click(); await wait();

  // ---------- Verificación con la JCE (Didit simulado) ----------
  const jce = (campo) => ($('#docjce-' + campo) || {}).textContent || '';
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  $('[data-view="inquilinos"] [data-new="inquilino"]').click(); await wait();
  set('mf-documento', '00100000009'); await wait(400);
  check('JCE sin configurar: ofrece configurarla', jce('documento').includes('Configurar verificación con la JCE'));
  $('#docjce-documento [data-didit-open]').click(); await wait(700);
  check('ventana de Didit sin configurar', $('#diditOverlay').classList.contains('show') && $('#diditStatus').textContent.includes('Sin configurar'));
  $('#diditKey').value = 'clave-mala-123';
  $('#diditSave').click(); await wait(500);
  check('clave guardada', $('#diditStatus').textContent.includes('Configurado'));
  check('al guardar prueba la clave y explica que no la reconoce', $('#diditPrueba').textContent.includes('no reconoce la clave'));
  $('#diditClose').click(); await wait(300);
  check('con clave: botón "Verificar con la JCE" (no consulta sola)', !!$('#docjce-documento [data-jce-verify]') && jce('documento').includes('Usa 1 consulta'));
  $('#docjce-documento [data-jce-verify]').click(); await wait(500);
  check('clave no reconocida: lo explica al verificar', jce('documento').includes('no reconoce la clave'));
  // Caso real: cuenta sin la primera recarga de saldo (403)
  $('[data-view="configuracion"] [data-didit-open]').click(); await wait(300);
  $('#diditKey').value = '  "clave-sin-saldo-123"  ';
  $('#diditSave').click(); await wait(500);
  check('cuenta sin recarga: explica que hay que recargar saldo', $('#diditPrueba').textContent.includes('recargues saldo por primera vez') && $('#diditPrueba').classList.contains('error'));
  $('#diditTest').click(); await wait(400);
  check('"Probar clave" repite la comprobación', $('#diditPrueba').textContent.includes('recargues saldo'));
  // Clave sin permiso para este servicio (403 genérico)
  $('#diditKey').value = 'clave-sin-permiso-123';
  $('#diditSave').click(); await wait(500);
  check('clave sin permiso: explica las causas y qué revisar', $('#diditPrueba').textContent.includes('no le permite verificar cédulas') &&
    $('#diditPrueba').textContent.includes('sandbox') && $('#diditPrueba').textContent.includes('soporte'));
  $('#diditKey').value = 'clave-buena-123456';
  $('#diditSave').click(); await wait(500);
  check('clave buena: confirma que funciona', $('#diditPrueba').textContent.includes('La clave funciona') && $('#diditPrueba').classList.contains('ok'));
  $('#diditClose').click(); await wait(300);
  $('#docjce-documento [data-jce-verify]').click(); await wait(600);
  check('JCE confirma la cédula', jce('documento').includes('La JCE confirma que esta cédula existe'));
  check('si la JCE devuelve el nombre, se rellena solo', $('#mf-nombre').value === 'Pedro Pablo Gomez' && sug('documento').includes('Completado con los datos de JCE'));
  set('mf-documento', '00100000017'); await wait(400);
  check('otra cédula: borra el nombre anterior y vuelve a ofrecer verificar', $('#mf-nombre').value === '' && !!$('#docjce-documento [data-jce-verify]'));
  $('#docjce-documento [data-jce-verify]').click(); await wait(600);
  check('JCE no encuentra la cédula: lo avisa', jce('documento').includes('La JCE no encontró esta cédula'));
  set('mf-documento', '00100000009'); await wait(500);
  check('cédula ya verificada: muestra el resultado sin consultar otra vez', jce('documento').includes('La JCE confirma') && jce('documento').includes('Verificada') && !$('#docjce-documento [data-jce-verify]'));
  $('#mgmtFormCancel').click(); await wait();

  // ---------- Menú recortado ----------
  const ancho = () => document.querySelector('.side-nav').getBoundingClientRect().width;
  // La ventana de la prueba está oculta y Electron frena ahí las transiciones.
  const sinAnimacion = document.createElement('style');
  sinAnimacion.textContent = '.app-shell{transition:none !important}';
  document.head.appendChild(sinAnimacion);
  check('menú completo por defecto', ancho() > 200 && $('#btnNavToggle').getAttribute('aria-pressed') === 'false');
  $('#btnNavToggle').click(); await wait(400);
  const etiqueta = document.querySelector('.nav-item[data-view="cobros"] > span');
  check('recortado: solo íconos, sin ocultarse (ancho ' + Math.round(ancho()) + ', etiqueta ' + getComputedStyle(etiqueta).display + ')', document.documentElement.classList.contains('nav-collapsed') && ancho() > 50 && ancho() < 80 && getComputedStyle(etiqueta).display === 'none');
  check('recortado: los íconos conservan su nombre como tooltip', document.querySelector('.nav-item[data-view="cobros"]').title === 'Cobros');
  const alerta = $('[data-count="atrasados"]');
  check('recortado: el aviso de atrasados sigue visible', !alerta.textContent || getComputedStyle(alerta).display !== 'none');
  check('recortado: se recuerda', localStorage.getItem('renthouse.menuRecortado') === '1' && $('#btnNavToggle').getAttribute('aria-pressed') === 'true');
  $('#btnNavToggle').click(); await wait(400);
  check('vuelve al menú completo (ancho ' + Math.round(ancho()) + ')', !document.documentElement.classList.contains('nav-collapsed') && ancho() > 200 && localStorage.getItem('renthouse.menuRecortado') === '0');

  // ---------- Animaciones y barra del menú ----------
  sinAnimacion.remove();
  check('el menú lateral no muestra barra de desplazamiento', getComputedStyle(document.querySelector('.side-nav')).scrollbarWidth === 'none');
  $('.nav-item[data-view="contratos"]').click(); await wait(50);
  check('al cambiar de vista se anima la entrada', document.querySelector('.view[data-view="contratos"]').classList.contains('view-enter') && document.getAnimations().length > 0);
  await wait(1500);
  const tarjeta = document.querySelector('.view[data-view="contratos"] .mgmt-card');
  check('al terminar no queda ningún transform (los menús ⋯ se ubican bien)', !document.querySelector('.view-enter') && getComputedStyle(tarjeta).transform === 'none');
  const filaMenu = document.querySelector('#tableContratos tbody tr');
  filaMenu.querySelector('[data-menu]').click(); await wait(300);
  const rBtn = filaMenu.querySelector('[data-menu]').getBoundingClientRect();
  const rMenu = filaMenu.querySelector('.row-menu').getBoundingClientRect();
  check('el menú ⋯ se abre junto a su botón', Math.abs(rMenu.right - rBtn.right) < 2 && rMenu.top >= rBtn.bottom - 1 && rMenu.top < rBtn.bottom + 12);
  document.body.click();

  // ---------- Configuración ----------
  check('la barra superior ya no tiene tema ni actualizaciones', !document.querySelector('.topbar [data-ap], .topbar #btnCheckUpdates'));
  $('.nav-item[data-view="configuracion"]').click(); await wait(500);
  const cfg = (sel) => document.querySelector('[data-view="configuracion"] ' + sel);
  check('configuración reúne tema, actualizaciones, respaldos, PIN e integraciones',
    ['[data-ap="tema"]', '#btnCheckUpdates', '#btnExportData', '#btnImportData', '#btnPinSettings', '[data-didit-open]'].every(s => !!cfg(s)));
  check('muestra el estado de cada cosa', $('#cfgDidit').textContent.includes('Activada') &&
    $('#cfgRespaldo').textContent.includes('Último') && $('#cfgCarpeta').textContent.includes('trabajo') && $('#cfgPin').textContent.includes('Desactivado'));
  // Apariencia
  const html = document.documentElement;
  const ap = (clave, valor) => cfg('[data-ap="' + clave + '"][data-valor="' + valor + '"]');
  const temaAntes = html.getAttribute('data-theme');
  ap('tema', temaAntes === 'light' ? 'dark' : 'light').click(); await wait(300);
  check('cambia el tema', html.getAttribute('data-theme') !== temaAntes && ap('tema', html.getAttribute('data-theme')).classList.contains('active'));
  ap('tema', 'system').click(); await wait(300);
  check('tema "Sistema" sigue a Windows', localStorage.getItem('redactorContratos.tema') === 'system' &&
    html.getAttribute('data-theme') === (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  const acentoAntes = getComputedStyle(html).getPropertyValue('--accent').trim();
  ap('acento', 'vino').click(); await wait(300);
  check('cambia el color de acento', html.dataset.acento === 'vino' && getComputedStyle(html).getPropertyValue('--accent').trim() !== acentoAntes &&
    ap('acento', 'vino').classList.contains('active') && $('#cfgAcentoNombre').textContent.includes('Vino'));
  const dpr = window.devicePixelRatio;
  ap('escala', '1.25').click(); await wait(400);
  check('agranda la interfaz', Math.abs(window.devicePixelRatio / dpr - 1.25) < 0.05);
  ap('densidad', 'compacta').click(); await wait(200);
  const celda = document.querySelector('.data-table td');
  check('densidad compacta', html.classList.contains('densidad-compacta') && (!celda || parseFloat(getComputedStyle(celda).paddingTop) <= 6));
  ap('fuente', 'serif').click(); await wait(200);
  check('cambia la fuente de la interfaz', getComputedStyle(document.body).fontFamily.includes('Source Serif'));
  ap('animaciones', 'no').click(); await wait(200);
  check('reduce las animaciones', html.classList.contains('sin-animaciones') && getComputedStyle(cfg('.seg-tab')).transitionDuration === '0s');
  const guardada = JSON.parse(localStorage.getItem('renthouse.apariencia'));
  check('la apariencia se guarda en este equipo', guardada.acento === 'vino' && guardada.escala === '1.25' && guardada.densidad === 'compacta' && guardada.fuente === 'serif' && guardada.animaciones === 'no');
  cfg('[data-ap-reset]').click(); await wait(400);
  check('"Restablecer" vuelve a la apariencia original', html.getAttribute('data-theme') === 'dark' && html.dataset.acento === 'azul' &&
    !html.classList.contains('densidad-compacta') && !html.classList.contains('sin-animaciones') && Math.abs(window.devicePixelRatio - dpr) < 0.05 &&
    ap('tema', 'dark').classList.contains('active'));
  if (temaAntes === 'light') { ap('tema', 'light').click(); await wait(300); }
  // Menú
  cfg('[data-cfg-menu="recortado"]').click(); await wait(300);
  check('recorta el menú desde configuración', document.documentElement.classList.contains('nav-collapsed') && cfg('[data-cfg-menu="recortado"]').classList.contains('active'));
  cfg('[data-cfg-menu="completo"]').click(); await wait(300);
  check('y lo vuelve a mostrar completo', !document.documentElement.classList.contains('nav-collapsed'));
  // Ajustes que se guardan con los datos
  const ajustar = async (clave, valor) => {
    const el = cfg('[data-ajuste="' + clave + '"]');
    el.value = valor;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(300);
  };
  await ajustar('despacho', 'Bufete Prueba SRL');
  check('avisa que se guardó', $('#cfgGuardado').textContent.includes('Guardado'));
  await ajustar('despachoTelefono', '809-555-0000');
  await ajustar('firma', 'Lic. Prueba');
  await ajustar('moneda', 'US$');
  await ajustar('diaPago', '5');
  await ajustar('duracionMeses', '6');
  await ajustar('moraTipo', 'porcentaje');
  await ajustar('moraValor', '3');
  await ajustar('papel', 'A4');
  await ajustar('diaPago', '45');
  check('rechaza valores fuera de rango', (noticeText() || '').includes('entre 1 y 31'));
  await okNotice(); await wait(300);
  check('y conserva el valor anterior', cfg('[data-ajuste="diaPago"]').value === '5');
  check('el papel del redactor sigue el ajuste', $('#paperSizeSelect').value === 'A4');
  // Los valores predeterminados llegan al crear un contrato
  $('.nav-item[data-view="contratos"]').click(); await wait();
  $('[data-view="contratos"] [data-new="contrato"]').click(); await wait();
  set('mf-fechaInicio', '2027-01-01');
  check('contrato nuevo con los valores predeterminados', $('#mf-moneda').value === 'US$' && $('#mf-diaPago').value === '5' &&
    $('#mf-moraTipo').value === 'porcentaje' && $('#mf-moraValor').value === '3' && $('#mf-fechaFin').value === '2027-06-30');
  $('#mgmtFormCancel').click(); await wait();
  // Recibo con el despacho y el papel configurados (se revisa en run.js)
  $('.nav-item[data-view="cobros"]').click(); await wait();
  set('cobrosMes', mesActual); await wait();
  $('#cobrosPagos [data-act="recibo"]').click(); await wait(400);
  // Recordatorio con la firma configurada
  $('.nav-item[data-view="contratos"]').click(); await wait();
  const conDeuda = [...document.querySelectorAll('#tableContratos [data-act="recordar"]')][0];
  conDeuda.click(); await wait(300);
  check('recordatorio con la firma y el teléfono del despacho', $('#reminderText').value.includes('Lic. Prueba') && $('#reminderText').value.includes('Tel. 809-555-0000'));
  $('#reminderClose').click(); await wait();

  // ---------- Casos de cobro y desalojo ----------
  const diaStr = (n) => { const d = new Date(); d.setDate(d.getDate() + (n || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const filaDeudor = conDeuda.closest('tr');
  const deudor = filaDeudor.querySelector('[data-act="ver-inquilino"]').textContent;
  check('contrato con atraso: "Abrir caso de cobro…" en su menú', !!filaDeudor.querySelector('.row-menu [data-act="abrir-caso"]'));
  filaDeudor.querySelector('.row-menu [data-act="abrir-caso"]').click(); await wait(300);
  check('formulario del caso con el contrato elegido', $('#mgmtFormTitle').textContent === 'Nuevo caso de cobro' && $('#mf-contratoId').selectedOptions[0].textContent.includes(deudor) && $('#mf-contratoId').selectedOptions[0].textContent.includes('debe'));
  set('mf-tribunal', 'Juzgado de Paz de la Primera Circunscripción');
  set('mf-numeroExpediente', '034-2026-00123');
  set('mf-alguacil', 'Pedro Ministerial');
  await submit(); await wait(300);
  const casoTxt = () => $('#casoBody').textContent;
  check('al crearlo se abre la ficha del caso', $('#casoOverlay').classList.contains('show') && casoTxt().includes(deudor) && casoTxt().includes('034-2026-00123'));
  check('empieza en "Intimación de pago" con 5 requisitos', $('.caso-etapas li.actual').textContent.includes('Intimación') && document.querySelectorAll('.caso-reqs li').length === 5 && casoTxt().includes('0/5'));
  check('el historial anota la deuda al abrir', casoTxt().includes('Caso abierto. Deuda: RD$'));
  document.querySelector('.caso-reqs input[type="checkbox"]').click(); await wait(300);
  check('marcar un requisito', casoTxt().includes('1/5') && document.querySelector('.caso-reqs li').classList.contains('hecho'));
  $('#casoReqTexto').value = 'Copia de la cédula del inquilino';
  document.querySelector('[data-act="caso-req-agregar"]').click(); await wait(300);
  check('añadir un requisito propio', document.querySelectorAll('.caso-reqs li').length === 6 && casoTxt().includes('Copia de la cédula del inquilino'));
  // Pasar a la demanda y agendar la audiencia
  document.querySelector('.caso-etapas [data-id="demanda"]').click(); await wait(300);
  check('pasar de etapa pide el detalle y la próxima fecha', $('#mgmtFormTitle').textContent === 'Pasar a: Demanda' && $('#mf-proxTipo').value === 'audiencia');
  set('mf-nota', 'Demanda depositada.');
  set('mf-proxFecha', diaStr(2));
  set('mf-proxHora', '09:30');
  set('mf-proxTitulo', 'Audiencia de conocimiento');
  await submit(); await wait(300);
  check('etapa actual: Demanda, con su anotación', $('.caso-etapas li.actual').textContent.includes('Demanda') && document.querySelectorAll('.caso-etapas li.hecha').length === 1 && casoTxt().includes('Etapa: Demanda. Demanda depositada.'));
  check('la audiencia queda en las fechas del caso', casoTxt().includes('Audiencia de conocimiento') && casoTxt().includes('09:30'));
  // Acto con los datos del caso
  window.rcEditor.loadHtml('<p>Intimamos a <span class="campo" contenteditable="false" data-label="Nombre del inquilino" data-value="">[Nombre del inquilino]</span> a pagar <span class="campo" contenteditable="false" data-label="Deuda en letras" data-value="">[Deuda en letras]</span> por <span class="campo" contenteditable="false" data-label="Meses adeudados" data-value="">[Meses adeudados]</span> (<span class="campo" contenteditable="false" data-label="Detalle de la deuda" data-value="">[Detalle de la deuda]</span>). Tribunal: <span class="campo" contenteditable="false" data-label="Juzgado" data-value="">[Juzgado]</span>, expediente <span class="campo" contenteditable="false" data-label="Número de expediente" data-value="">[Número de expediente]</span>. Alquiler: <span class="campo" contenteditable="false" data-label="Monto del alquiler en letras" data-value="">[x]</span>.</p>');
  $('#casoRedactar').click(); await wait(400);
  check('"Redactar acto" abre el selector de modelos del caso', $('#templatePickerOverlay').classList.contains('show') && $('#templatePickerSub').textContent.startsWith('Acto del caso de'));
  document.querySelector('[data-pick="current"]').click(); await wait(500);
  const valorCampo = (label) => ($('#editor .campo[data-label="' + label + '"]') || {}).textContent || '';
  check('el acto se rellena con la deuda en letras', /^[A-ZÁÉÍÓÚÑ ]+ PESOS DOMINICANOS CON \d\d\/100 \(RD\$ [\d,]+\.\d\d\)$/.test(valorCampo('Deuda en letras')));
  check('y con meses, tribunal (por alias) y expediente', /\d+ mes/.test(valorCampo('Meses adeudados')) && valorCampo('Detalle de la deuda').length > 4 &&
    valorCampo('Juzgado') === 'Juzgado de Paz de la Primera Circunscripción' && valorCampo('Número de expediente') === '034-2026-00123');
  check('monto en letras correcto', valorCampo('Monto del alquiler en letras') === 'VEINTE MIL PESOS DOMINICANOS CON 00/100 (RD$ 20,000.00)');
  check('el acto no se asocia al documento del contrato', $('#contractLinkBar').hidden && $('#baseName').value.startsWith('acto_'));
  // Contratos y ficha del inquilino muestran el caso
  $('.nav-item[data-view="contratos"]').click(); await wait();
  const filaCaso = [...document.querySelectorAll('#tableContratos tbody tr')].find(tr => tr.textContent.includes('En caso: Demanda'));
  check('el contrato indica la etapa del caso', !!filaCaso && !!filaCaso.querySelector('.row-menu [data-act="ver-caso"]') && !filaCaso.querySelector('.row-menu [data-act="abrir-caso"]'));
  check('contador de casos abiertos en el menú', $('[data-count="casosAbiertos"]').textContent === '1');
  // Resumen: la audiencia de los próximos días
  $('.nav-item[data-view="resumen"]').click(); await wait();
  check('el Resumen avisa de la audiencia', $('#dashAlerts').textContent.includes('Audiencia de conocimiento') && $('#dashAlerts').textContent.includes('En 2 días'));
  // Vista Casos
  $('.nav-item[data-view="casos"]').click(); await wait();
  check('lista de casos con etapa y próxima fecha', $('#tableCasos').textContent.includes(deudor) && $('#tableCasos').textContent.includes('Demanda') && $('#tableCasos').textContent.includes('Audiencia de conocimiento'));

  // ---------- Agenda ----------
  $('.nav-item[data-view="agenda"]').click(); await wait(300);
  check('calendario del mes con sus días', document.querySelectorAll('#agendaCal .ag-dia').length >= 28 && !!$('#agendaCal .ag-dia.hoy'));
  check('pendientes: la audiencia en los próximos 7 días', $('#agendaLista').textContent.includes('Próximos 7 días') && $('#agendaLista').textContent.includes('Audiencia de conocimiento'));
  for (let i = 0; i < 36 && !document.querySelector('#agendaCal .ag-dia:not(.fuera) .ag-puntos i.ag-vencimiento'); i++) { $('#agendaNext').click(); await wait(50); }
  check('los vencimientos de contratos aparecen solos en el calendario', !!document.querySelector('#agendaCal .ag-dia:not(.fuera) .ag-puntos i.ag-vencimiento') && $('#agendaCal').textContent.includes('Vence el contrato'));
  $('#agendaHoy').click(); await wait();
  $('[data-view="agenda"] [data-new="evento"]').click(); await wait();
  set('mf-titulo', 'Depositar la certificación');
  set('mf-tipo', 'plazo');
  set('mf-fecha', diaStr(-1));
  await submit(); await wait(300);
  check('un plazo vencido aparece como atrasado', $('#agendaLista').textContent.includes('Atrasado') && $('#agendaLista .ag-item.atrasado').textContent.includes('Depositar la certificación'));
  check('y cuenta en el menú', $('[data-count="agendaPendiente"]').textContent === '1');
  $('#agendaLista .ag-item.atrasado [data-act="evento-hecho"]').click(); await wait(300);
  check('marcarlo como hecho lo quita de pendientes', !$('#agendaLista').textContent.includes('Depositar la certificación') && $('[data-count="agendaPendiente"]').textContent === '');
  if (!document.querySelector('#agendaCal [data-dia="' + diaStr(2) + '"]')) { $('#agendaNext').click(); await wait(); }
  document.querySelector('#agendaCal [data-dia="' + diaStr(2) + '"]').click(); await wait();
  check('elegir un día muestra lo de ese día', !!$('#agendaCal .ag-dia.elegido[data-dia="' + diaStr(2) + '"]') &&$('#agendaLista').textContent.includes('Audiencia de conocimiento') && !!$('#agendaLista [data-act="nuevo-evento-dia"]'));
  $('#agendaLista [data-act="agenda-todo"]').click(); await wait();
  // Cerrar el caso
  $('#agendaLista [data-act="ver-caso"]').click(); await wait(300);
  $('#casoCerrar').click(); await wait();
  set('mf-resultado', 'acuerdo');
  set('mf-nota', 'Acuerdo de pago en 3 cuotas.');
  await submit(); await wait(300);
  check('cerrar el caso con su resultado', casoTxt().includes('Cerrado el') && casoTxt().includes('Acuerdo de pago') && $('#casoCerrar').textContent === 'Reabrir caso' && document.querySelectorAll('.caso-etapas button:not([disabled])').length === 0);
  check('sus fechas pendientes se dan por hechas', !document.querySelector('#casoBody .ag-item:not(.hecho)'));
  $('#casoClose').click(); await wait();
  check('sin casos abiertos en el menú', $('[data-count="casosAbiertos"]').textContent === '');

  // ---------- Búsqueda global (Ctrl+K) ----------
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true })); await wait();
  check('Ctrl+K abre la búsqueda', $('#buscarOverlay').classList.contains('show') && document.activeElement === $('#buscarInput'));
  set('buscarInput', deudor.split(' ')[0].toLowerCase()); await wait();
  const tiposBusqueda = [...document.querySelectorAll('#buscarResultados .busca-tipo')].map(e => e.textContent);
  check('encuentra al inquilino, su contrato y su caso', tiposBusqueda.includes('Inquilino') && tiposBusqueda.includes('Contrato') && tiposBusqueda.includes('Caso'));
  set('buscarInput', '034-2026'); await wait();
  check('busca por número de expediente', $('#buscarResultados').textContent.includes('Exp. 034-2026-00123'));
  set('buscarInput', deudor); await wait();
  $('#buscarInput').dispatchEvent(new KeyboardEvent('keydown', { key:'Enter', bubbles:true })); await wait(300);
  check('Enter abre el primer resultado (la ficha del inquilino)', !$('#buscarOverlay').classList.contains('show') && $('#tenantDetailOverlay').classList.contains('show') && $('#tenantDetailBody').textContent.includes(deudor));
  check('la ficha del inquilino muestra su caso', $('#tenantDetailBody').textContent.includes('Caso cerrado'));
  $('#tenantDetailClose').click(); await wait();

  // ---------- Recordatorios en lote ----------
  $('.nav-item[data-view="cobros"]').click(); await wait();
  $('#btnLote').click(); await wait();
  const filasLote = () => [...document.querySelectorAll('#loteLista .lote-fila')];
  check('lista de recordatorios con todos los atrasados', $('#loteOverlay').classList.contains('show') && filasLote().length === Number($('[data-count="atrasados"]').textContent) && filasLote().length > 0);
  const filaWa = filasLote().find(f => !f.querySelector('[data-lote="wa"]').disabled);
  const nombreWa = filaWa.querySelector('strong').textContent;
  const filaAtrasado = () => filasLote().find(f => f.querySelector('strong').textContent === nombreWa);
  const conWhatsApp = filasLote().filter(f => !f.querySelector('[data-lote="wa"]').disabled).length;

  // Enviar a todos sin correo configurado: lo avisa y guía los WhatsApp uno a uno
  $('#loteTodos').click(); await wait(400);
  check('sin correo configurado: empieza el WhatsApp guiado', !$('#loteGuia').hidden && $('#loteGuiaPaso').textContent === 'WhatsApp 1 de ' + conWhatsApp &&
    filasLote().some(f => f.classList.contains('actual')) && $('#loteTodos').disabled);
  for (let i = 0; i < conWhatsApp; i++) { $('#loteGuiaAbrir').click(); await wait(250); }
  check('al abrir el último chat termina y lo resume', $('#loteGuia').hidden && $('#loteEstado').textContent.startsWith('Listo') &&
    $('#loteEstado').textContent.includes(conWhatsApp + ' WhatsApp abierto') && filaAtrasado().textContent.includes('Enviado por WhatsApp ✓'));
  filaAtrasado().querySelector('[data-lote="wa"]').click(); await wait(300);
  check('el botón de WhatsApp de cada fila sigue funcionando', filaAtrasado().textContent.includes('Enviado por WhatsApp'));
  $('#loteClose').click(); await wait();

  // Se le añade correo al inquilino
  $('.nav-item[data-view="inquilinos"]').click(); await wait();
  [...document.querySelectorAll('#tableInquilinos [data-act="ver-inquilino"]')].find(b => b.textContent === nombreWa).click(); await wait();
  $('#tenantDetailEdit').click(); await wait();
  set('mf-email', 'inquilino@ejemplo.com');
  await submit();
  if ($('#tenantDetailOverlay').classList.contains('show')) { $('#tenantDetailClose').click(); await wait(); }

  // Configurar el correo de envío (servidor simulado en run.js)
  $('.nav-item[data-view="configuracion"]').click(); await wait(300);
  check('Configuración: correo sin configurar', $('#cfgCorreo').textContent.startsWith('Sin configurar'));
  document.querySelector('.cfg-row [data-correo-open]').click(); await wait(300);
  check('ventana del correo: Gmail por defecto y su ayuda', $('#correoOverlay').classList.contains('show') && $('#correoProveedor').value === 'gmail' && $('#correoServidor').hidden && !$('#correoAyudaGmail').hidden && $('#correoProbar').disabled);
  set('correoUsuario', 'despacho@gmail.com');
  set('correoPass', 'mala mala');
  $('#correoGuardar').click(); await wait(300);
  $('#correoProbar').click(); await wait(400);
  check('contraseña rechazada: explica la contraseña de aplicación', $('#correoPrueba').textContent.includes('contraseña de aplicación'));
  set('correoPass', 'abcd efgh ijkl mnop');
  $('#correoGuardar').click(); await wait(300);
  $('#correoProbar').click(); await wait(400);
  check('correo configurado y probado', $('#correoEstado').textContent === 'Configurado: despacho@gmail.com' && $('#correoPrueba').textContent.startsWith('Funciona') && $('#correoPass').value === '');
  set('correoProveedor', 'otro'); $('#correoProveedor').dispatchEvent(new Event('change')); await wait();
  check('"Otro" pide servidor y puerto', !$('#correoServidor').hidden && $('#correoAyudaGmail').hidden);
  $('#correoCerrar').click(); await wait(300);
  check('Configuración: correo activado', $('#cfgCorreo').textContent.includes('despacho@gmail.com'));

  // Enviar a todos con correo: se envía solo, sin repetir el WhatsApp
  $('.nav-item[data-view="cobros"]').click(); await wait();
  $('#btnLote').click(); await wait();
  $('#loteTodos').click(); await wait(800);
  check('Enviar a todos: correo automático, sin volver a abrir WhatsApp', $('#loteGuia').hidden && /\d+ correos? enviados?/.test($('#loteEstado').textContent) &&
    filaAtrasado().textContent.includes('Enviado por correo y WhatsApp ✓'));
  $('#loteTodos').click(); await wait(400);
  check('una segunda vez no repite envíos', $('#loteGuia').hidden && !$('#loteEstado').textContent.includes('enviado'));
  $('#loteClose').click(); await wait();

  // ---------- Aumento anual ----------
  const masUnMes = (p) => { const [y, m] = p.split('-').map(Number); const d = new Date(y, m, 1); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); };
  const mesHoy = diaStr(0).slice(0, 7);
  const dinero = (t) => Number(String(t).replace(/[^\d.]/g, ''));
  $('.nav-item[data-view="contratos"]').click(); await wait();
  const filaAum = [...document.querySelectorAll('#tableContratos tbody tr')].find(tr => tr.querySelector('.row-menu [data-act="aumento"]'));
  const ctrAum = filaAum.querySelector('[data-act="aumento"]').dataset.id;
  const inqAum = filaAum.querySelector('[data-act="ver-inquilino"]').textContent;
  filaAum.querySelector('[data-act="aumento"]').click(); await wait(300);
  const alquilerAntes = Number($('#mf-monto').value);
  const mesIni = $('#mf-desde').value;
  check('"Aplicar aumento…" propone desde el mes siguiente (o el inicio del contrato) con el monto actual', $('#mgmtFormTitle').textContent === 'Aplicar aumento' && alquilerAntes > 0 && mesIni >= masUnMes(mesHoy));
  const mesAum = masUnMes(mesIni);
  set('mf-desde', mesAum);
  set('mf-pct', '10'); await wait();
  check('el porcentaje calcula el nuevo alquiler', Math.abs(Number($('#mf-monto').value) - alquilerAntes * 1.1) < 0.01);
  await submit(); await wait(400);
  check('prepara el aviso de aumento para el inquilino', $('#reminderOverlay').classList.contains('show') && $('#reminderTitulo').textContent === 'Aviso de aumento' &&
    $('#reminderText').value.includes(inqAum) && $('#reminderText').value.includes('a partir de'));
  $('#reminderClose').click(); await wait();
  // La cuota anterior al aumento conserva el monto; la del mes del aumento, el nuevo.
  $('.nav-item[data-view="cobros"]').click(); await wait();
  $('[data-view="cobros"] [data-new="pago"]').click(); await wait();
  set('mf-contratoId', ctrAum); set('mf-periodo', mesIni); await wait();
  const cuotaAntes = dinero($('#pagoHint').textContent.split('·')[0]);
  set('mf-periodo', mesAum); await wait();
  const cuotaDespues = dinero($('#pagoHint').textContent.split('·')[0]);
  check('las cuotas anteriores conservan su monto y las nuevas llevan el aumento', Math.abs(cuotaAntes - alquilerAntes) < 0.01 && Math.abs(cuotaDespues - alquilerAntes * 1.1) < 0.01);
  $('#mgmtFormCancel').click(); await wait();

  // ---------- ITBIS del alquiler y retención de ISR ----------
  $('.nav-item[data-view="contratos"]').click(); await wait();
  [...document.querySelectorAll('#tableContratos [data-act="editar-contrato"]')].find(b => b.dataset.id === ctrAum).click(); await wait(300);
  const alqNuevo = Math.round(alquilerAntes * 110) / 100;
  check('el contrato tiene aumento anual, ITBIS y retención', !!$('#mf-aumentoPct') && !!$('#mf-itbis') && !!$('#mf-retencionIsr') && Number($('#mf-monto').value) === alqNuevo);
  set('mf-itbis', '18'); set('mf-retencionIsr', '10');
  await submit(); await wait(300);
  $('.nav-item[data-view="cobros"]').click(); await wait();
  $('[data-view="cobros"] [data-new="pago"]').click(); await wait();
  set('mf-contratoId', ctrAum); set('mf-periodo', mesAum); await wait();
  const itbisNuevo = Math.round(alqNuevo * 18) / 100;
  const retNuevo = Math.round(alqNuevo * 10) / 100;
  check('la cuota incluye el ITBIS', $('#pagoHint').textContent.includes('incluye ITBIS') && Math.abs(dinero($('#pagoHint').textContent.split('(')[0]) - (alqNuevo + itbisNuevo)) < 0.02);
  check('propone la retención de ISR sobre el alquiler y el resto como recibido', Math.abs(Number($('#mf-retencion').value) - retNuevo) < 0.01 && Math.abs(Number($('#mf-monto').value) - (alqNuevo + itbisNuevo - retNuevo)) < 0.02);
  set('mf-referencia', 'TRX-ISR');
  await submit(); await wait(300);
  set('cobrosMes', mesAum); await wait();
  const filaIsr = [...document.querySelectorAll('#cobrosPagos tbody tr')].find(tr => tr.textContent.includes('TRX-ISR'));
  check('el pago con retención salda la cuota y muestra lo retenido', !!filaIsr && filaIsr.textContent.includes('ISR retenido') &&
    [...document.querySelectorAll('#cobrosCuotas tbody tr')].some(tr => tr.textContent.includes(inqAum) && tr.textContent.includes('Pagado')));
  filaIsr.querySelector('[data-act="recibo"]').click(); await wait(400);
  // Liquidación: el ISR retenido y el ITBIS de la comisión
  $('.nav-item[data-view="configuracion"]').click(); await wait(300);
  const itbisCfg = document.querySelector('[data-ajuste="itbisComision"]');
  itbisCfg.value = '18'; itbisCfg.dispatchEvent(new Event('change', { bubbles:true })); await wait(300);
  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  set('liqMes', mesHoy); await wait();
  const liqTxt = $('#liqTabla').textContent;
  check('liquidaciones con el ITBIS de la comisión', liqTxt.includes('+ ITBIS'));
  check('lo retenido aparece en la liquidación del propietario', liqTxt.includes('ISR retenido'));
  $('.nav-item[data-view="configuracion"]').click(); await wait(300);
  itbisCfg.value = ''; itbisCfg.dispatchEvent(new Event('change', { bubbles:true })); await wait(300);

  // ---------- PDF ----------
  document.querySelector('#cobrosPagos .row-menu [data-act="recibo-pdf"]').click(); await wait(2500);
  check('"Guardar recibo en PDF" lo guarda y ofrece abrirlo', noticeText() !== null && noticeText().includes('PDF guardado: Recibo_'));
  $('#noticeCancelBtn').click(); await wait();

  // ---------- Mantenimiento ----------
  $('.nav-item[data-view="mantenimiento"]').click(); await wait();
  check('mantenimiento sin solicitudes', $('#tableReparaciones').textContent.includes('Sin solicitudes'));
  $('[data-view="mantenimiento"] [data-new="reparacion"]').click(); await wait();
  set('mf-edificioId', document.querySelector('#mf-edificioId option[value]:not([value=""])').value); await wait();
  const aptoRep = [...$('#mf-unidadId').options].find(o => o.value);
  set('mf-unidadId', aptoRep.value);
  set('mf-descripcion', 'Filtración en el baño principal');
  set('mf-prioridad', 'urgente');
  set('mf-reportadoPor', 'Inquilino');
  await submit(); await wait(300);
  check('la solicitud aparece sin resolver y cuenta en el menú', $('#tableReparaciones').textContent.includes('Filtración en el baño principal') && $('#tableReparaciones').textContent.includes('Urgente') &&
    $('[data-count="reparacionesAbiertas"]').textContent === '1');
  $('.nav-item[data-view="resumen"]').click(); await wait();
  check('el Resumen avisa de la reparación urgente', $('#dashAlerts').textContent.includes('Filtración en el baño principal'));
  $('.nav-item[data-view="mantenimiento"]').click(); await wait();
  document.querySelector('#tableReparaciones [data-act="resolver-reparacion"]').click(); await wait();
  set('mf-costo', '3500'); set('mf-responsable', 'Plomería Rápida');
  await submit(); await wait(300);
  check('resolverla la quita de pendientes', !$('#tableReparaciones').textContent.includes('Filtración') && $('[data-count="reparacionesAbiertas"]').textContent === '');
  set('mntEstado', 'resuelta'); await wait();
  check('y queda como resuelta con su costo en Gastos', $('#tableReparaciones').textContent.includes('Resuelta') && $('#tableReparaciones').textContent.includes('en Gastos'));
  $('.nav-item[data-view="gastos"]').click(); await wait();
  set('gastosMes', diaStr(0).slice(0, 7)); await wait();
  check('el gasto de la reparación se registró', [...document.querySelectorAll('[data-view="gastos"] tbody tr')].some(tr => tr.textContent.includes('Filtración en el baño principal') && tr.textContent.includes('3,500.00') && tr.textContent.includes('Reparación')));

  // ---------- Estados de cuenta del mes ----------
  $('.nav-item[data-view="liquidaciones"]').click(); await wait();
  set('liqMes', diaStr(0).slice(0, 7)); await wait();
  const filasLiq = document.querySelectorAll('#liqTabla tbody tr').length;
  $('#btnEnvioEstados').click(); await wait();
  const filasEnvio = () => [...document.querySelectorAll('#envioLista .lote-fila')];
  check('lista de estados de cuenta del mes, uno por propietario', $('#envioOverlay').classList.contains('show') && filasEnvio().length === filasLiq && filasLiq > 0);
  filasEnvio()[0].querySelector('[data-envio="pdf"]').click(); await wait(2500);
  check('estado de cuenta en PDF', noticeText() !== null && noticeText().includes('PDF guardado: Liquidacion_'));
  $('#noticeCancelBtn').click(); await wait();
  const conCanal = filasEnvio().find(f => !f.querySelector('[data-envio="wa"]').disabled || !f.querySelector('[data-envio="correo"]').disabled);
  if (conCanal) {
    (conCanal.querySelector('[data-envio="wa"]:not([disabled])') || conCanal.querySelector('[data-envio="correo"]')).click(); await wait(300);
    check('enviarlo lo marca como enviado', filasEnvio().some(f => f.classList.contains('enviado')));
  }
  $('#envioTodos').click(); await wait(2500);
  check('todas las liquidaciones en un PDF', noticeText() !== null && noticeText().includes('Liquidaciones_'));
  $('#noticeCancelBtn').click(); await wait();
  $('#envioClose').click(); await wait();

  // ---------- Acta de entrega y devolución ----------
  $('.nav-item[data-view="contratos"]').click(); await wait();
  const filaActa = [...document.querySelectorAll('#tableContratos tbody tr')].find(tr => tr.querySelector('.row-menu [data-act="acta"]'));
  const idActa = filaActa.querySelector('.row-menu [data-act="acta"]').dataset.id;
  filaActa.querySelector('.row-menu [data-act="acta"]').click(); await wait(300);
  const filasActa = () => [...document.querySelectorAll('#actaItems tr')];
  check('acta de entrega con el inventario básico en "Bueno"', $('#actaOverlay').classList.contains('show') && $('#actaTitulo').textContent === 'Acta de entrega del inmueble' &&
    filasActa().length === 21 && filasActa().every(tr => tr.querySelector('[data-k="estado"]').value === 'Bueno') && $('#actaColEntrega').hidden);
  filasActa()[1].querySelector('[data-k="estado"]').value = 'Regular';
  filasActa()[1].querySelector('[data-k="nota"]').value = 'Rayado frente a la puerta';
  $('#acta-luz').value = '12345'; $('#acta-llaves').value = '3';
  $('#actaAddItem').click(); await wait();
  filasActa()[21].querySelector('[data-k="elemento"]').value = 'Lámpara de techo';
  $('#actaGuardar').click(); await wait(300);
  check('guardar el acta de entrega', !$('#actaBorrar').hidden && filasActa().length === 22);
  $('#actaClose').click(); await wait();
  const filaActa2 = [...document.querySelectorAll('#tableContratos tbody tr')].find(tr => tr.querySelector('.row-menu [data-act="acta"][data-id="' + idActa + '"]'));
  check('el contrato ofrece ver el acta y hacer la de devolución', filaActa2.textContent.includes('Ver acta de entrega') && !!filaActa2.querySelector('.row-menu [data-act="acta"][data-id$="|devolucion"]'));
  filaActa2.querySelector('.row-menu [data-act="acta"][data-id$="|devolucion"]').click(); await wait(300);
  check('la devolución parte del inventario de la entrega', $('#actaTitulo').textContent === 'Acta de devolución del inmueble' && !$('#actaColEntrega').hidden &&
    filasActa().length === 22 && filasActa()[1].querySelector('.acta-entrega').textContent === 'Regular' && filasActa()[21].querySelector('[data-k="elemento"]').value === 'Lámpara de techo');
  const selPiso = filasActa()[1].querySelector('[data-k="estado"]');
  selPiso.value = 'Malo'; selPiso.dispatchEvent(new Event('change', { bubbles:true })); await wait();
  check('marca lo que está peor que al entregar', filasActa()[1].classList.contains('acta-peor') && $('#actaResumen').textContent.startsWith('1 elemento está en peor estado'));
  $('#actaFotosAdd').click(); await wait(400);
  check('adjuntar fotos al acta (en el expediente)', $('#actaFotos').textContent.includes('cedula-escaneada.txt'));
  $('#actaGuardar').click(); await wait(300);
  $('#actaImprimir').click(); await wait(400);
  $('#actaClose').click(); await wait();

  // ---------- Redactor: página real, zoom, panel, campos agrupados ----------
  $('.nav-item[data-view="redactor"]').click(); await wait(400);
  const ed = $('#editor');
  check('la página usa el papel configurado (A4)', ed.style.getPropertyValue('--page-w') === '210mm' && ed.style.getPropertyValue('--page-h') === '297mm');
  set('paperSizeSelect', 'Letter'); $('#paperSizeSelect').dispatchEvent(new Event('change'));
  $('#landscapeCheckbox').checked = true; $('#landscapeCheckbox').dispatchEvent(new Event('change')); await wait();
  check('papel Carta horizontal: 11 × 8.5 in', ed.style.getPropertyValue('--page-w') === '11in' && ed.style.getPropertyValue('--page-h') === '8.5in');
  $('#landscapeCheckbox').checked = false; $('#landscapeCheckbox').dispatchEvent(new Event('change')); await wait();
  $('#zoomIn').click(); await wait();
  const zoomManual = $('#zoomValue').textContent;
  $('#zoomFit').click(); await wait(200);
  check('"Ajustar" encaja la página en el ancho disponible', /^\d+%$/.test($('#zoomValue').textContent) && parseInt($('#zoomValue').textContent, 10) <= 100 && $('#zoomValue').textContent !== zoomManual);
  check('contador de palabras y páginas', /\d+ palabras? · \d+ páginas?/.test($('#rdStats').textContent));
  // Panel lateral plegable
  $('#rdPanelToggle').click(); await wait();
  check('el panel lateral se puede ocultar', $('#rdShell').classList.contains('panel-oculto') && $('#rdSide').offsetParent === null);
  $('#rdPanelToggle').click(); await wait();
  check('y volver a mostrar', $('#rdSide').offsetParent !== null);
  // Campos agrupados por nombre y edición de todos a la vez
  window.rcEditor.loadHtml('<p>Arrendatario: <span class="campo" id="t1" contenteditable="false" data-label="Nombre" data-value="">[Nombre]</span>. Firma: <span class="campo" id="t2" contenteditable="false" data-label="Nombre" data-value="">[Nombre]</span>. Ciudad: <span class="campo" id="t3" contenteditable="false" data-label="Ciudad" data-value="Santo Domingo">Santo Domingo</span>.</p>');
  document.querySelector('[data-lib-tab="campos"]').click(); await wait();
  const filas = () => [...document.querySelectorAll('#fieldsList .field-row')];
  check('pestaña Campos: una fila por nombre, con repeticiones y pendientes', filas().length === 2 && filas()[0].textContent.includes('×2') && filas()[0].classList.contains('is-empty') &&
    $('#fieldsSummary').textContent === '2 campos · 1 sin completar' && $('#libCountCampos').textContent === '2');
  filas()[0].querySelector('[data-fr="editar"]').click(); await wait();
  check('editar ofrece aplicar a todos los iguales', !$('#fieldApplyAllWrap').hidden && $('#fieldApplyAllText').textContent.includes('los 2 campos "Nombre"'));
  $('#fieldValue').value = 'Ana Rodríguez';
  $('#fieldSave').click(); await wait();
  check('se actualizan todos los campos iguales', ed.querySelectorAll('.campo')[0].textContent === 'Ana Rodríguez' && ed.querySelectorAll('.campo')[1].textContent === 'Ana Rodríguez' && $('#fieldsSummary').textContent.includes('todos completos'));
  filas()[1].querySelector('[data-fr="quitar"]').click(); await wait();
  check('quitar un campo desde el panel', ed.querySelectorAll('.campo').length === 2 && filas().length === 1);
  // Salto de página
  const rango = document.createRange(); rango.selectNodeContents(ed.querySelector('p')); rango.collapse(false);
  ed.focus(); window.getSelection().removeAllRanges(); window.getSelection().addRange(rango); await wait();
  $('#btnPageBreak').click(); await wait();
  check('inserta un salto de página', !!ed.querySelector('.salto-pagina'));
  // Ctrl+S guarda una versión .doc
  const docsAntes = Number($('#libCountDocs').textContent || 0);
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'s', ctrlKey:true, bubbles:true })); await wait(1300);
  check('Ctrl+S guarda una versión .doc', Number($('#libCountDocs').textContent || 0) === docsAntes + 1);
  $('#btnPdf').click(); await wait(2500);
  check('botón PDF del redactor', $('#saveStatus').textContent.startsWith('PDF guardado:'));
  check('lo que sigue al salto de página empieza en la hoja 2', /· 2 páginas/.test($('#rdStats').textContent) && !!ed.querySelector('.salto-pagina ~ .pag-salto'));

  // Hojas como en Word: ningún párrafo cruza el final de una hoja
  window.rcEditor.loadHtml(Array.from({ length: 70 }, (_, i) => '<p>Cláusula ' + (i + 1) + '. ' + 'El inquilino se obliga a cumplir lo pactado en este contrato. '.repeat(1 + i % 4) + '</p>').join('') + '<p></p><p><br></p><p>Fin.</p>');
  await wait(400);
  const hojas = () => {
    const alto = 11 * 96, margen = Number($('#margenSelect').value) * 96 / 2.54, paso = alto + 24;
    const escala = ed.getBoundingClientRect().height / ed.offsetHeight, origen = ed.getBoundingClientRect().top;
    return [...ed.querySelectorAll('p')].every(p => {
      const r = p.getBoundingClientRect(), top = (r.top - origen) / escala + (parseFloat(getComputedStyle(p).paddingTop) || 0), bajo = (r.bottom - origen) / escala;
      const n = Math.floor(top / paso);
      return top >= n * paso + margen - 1 && bajo <= n * paso + alto - margen + 1;
    });
  };
  check('documento largo: varias hojas y cada párrafo dentro del área de texto', parseInt($('#rdStats').textContent.split('·')[1], 10) >= 3 && hojas());
  check('el alto del editor es un número exacto de hojas', Math.abs((ed.offsetHeight + 24) / (11 * 96 + 24) - Math.round((ed.offsetHeight + 24) / (11 * 96 + 24))) < 0.01);
  check('el paginado no se guarda en el documento', !window.rcEditor.getHtml().includes('pag-salto') && !window.rcEditor.getHtml().includes('--pag'));
  const paginasAntes = parseInt($('#rdStats').textContent.split('·')[1], 10);
  set('margenSelect', '3.18'); $('#margenSelect').dispatchEvent(new Event('change')); await wait(200);
  check('márgenes amplios: la hoja los usa y el texto ocupa más hojas', ed.style.getPropertyValue('--margen') === '3.18cm' && parseInt($('#rdStats').textContent.split('·')[1], 10) > paginasAntes && hojas());
  // El PDF debe tener las mismas páginas que el editor (lo comprueba run.js por el nombre)
  const baseAntes = $('#baseName').value;
  $('#baseName').value = 'paginas_' + parseInt($('#rdStats').textContent.split('·')[1], 10);
  $('#btnPdf').click(); await wait(2500);
  $('#baseName').value = baseAntes;
  set('margenSelect', '2'); $('#margenSelect').dispatchEvent(new Event('change')); await wait(200);

  // Interlineado y espacio entre párrafos
  const p1 = ed.querySelector('p');
  const r1 = document.createRange(); r1.selectNodeContents(p1); ed.focus(); window.getSelection().removeAllRanges(); window.getSelection().addRange(r1);
  $('#btnInterlineado').click(); await wait();
  check('menú de interlineado abierto, con el actual marcado', !$('#menuInterlineado').hidden && $('#menuInterlineado [data-interlineado].active') === null);
  $('#menuInterlineado [data-interlineado="1"]').click(); await wait();
  check('interlineado sencillo en el párrafo elegido', p1.style.lineHeight === '1' && ed.querySelectorAll('p')[1].style.lineHeight === '' && $('#menuInterlineado [data-interlineado="1"]').classList.contains('active'));
  $('#menuInterlineado [data-interlineado-paso="0.1"]').click(); await wait();
  check('"Separar líneas" amplía poco a poco', p1.style.lineHeight === '1.1');
  $('#menuInterlineado [data-parrafo="0"]').click(); await wait();
  check('sin espacio después del párrafo', p1.style.marginBottom === '0pt');
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'2', ctrlKey:true, bubbles:true })); await wait();
  check('Ctrl+2: interlineado doble', p1.style.lineHeight === '2');
  $('#interlineadoTodo').checked = true;
  $('#menuInterlineado [data-interlineado="1.15"]').click(); await wait();
  check('aplicar a todo el documento', [...ed.querySelectorAll('p')].every(p => p.style.lineHeight === '1.15'));
  const parrafosAntes = ed.querySelectorAll('p').length;
  $('#menuInterlineado [data-accion="quitar-vacias"]').click(); await wait(300);
  check('quitar líneas vacías', ed.querySelectorAll('p').length === parrafosAntes - 2 && $('#interlineadoNota').textContent.includes('2 líneas vacías') && hojas());
  $('#interlineadoTodo').checked = false;
  document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles:true })); await wait();
  check('el menú se cierra al hacer clic fuera', $('#menuInterlineado').hidden);

  // Los campos toman el formato de la selección (el navegador los salta)
  window.rcEditor.loadHtml('<p>Arrendatario: <span class="campo" id="cf1" contenteditable="false" data-label="Nombre" data-value="">[Nombre]</span>, mayor de edad.</p>');
  await wait(200);
  const selTodo = () => { const r = document.createRange(); r.selectNodeContents(ed.querySelector('p')); ed.focus(); window.getSelection().removeAllRanges(); window.getSelection().addRange(r); };
  const campoF = () => ed.querySelector('.campo');
  const textoF = () => getComputedStyle(ed.querySelector('p font') || ed.querySelector('p'));
  selTodo(); await wait();
  set('formatFontSelect', 'Arial'); $('#formatFontSelect').dispatchEvent(new Event('change')); await wait();
  selTodo(); await wait();
  set('formatSizeSelect', '5'); $('#formatSizeSelect').dispatchEvent(new Event('change')); await wait();
  check('fuente y tamaño también en el campo, iguales al texto', getComputedStyle(campoF()).fontFamily === textoF().fontFamily && getComputedStyle(campoF()).fontSize === textoF().fontSize && /Arial/.test(getComputedStyle(campoF()).fontFamily));
  selTodo(); await wait();
  $('[data-command="bold"]').click(); await wait();
  check('negrita también en el campo', getComputedStyle(campoF()).fontWeight === '700');
  selTodo(); await wait();
  $('[data-command="bold"]').click(); await wait();
  check('y se puede quitar', getComputedStyle(campoF()).fontWeight !== '700');
  campoF().setAttribute('data-value', 'Ana Rodríguez\nPasaporte 123');
  check('el formato se guarda con el documento', /font-family:[^;"]*Arial/.test(window.rcEditor.getHtml()) && /font-size:\s*x-large/.test(window.rcEditor.getHtml()));
  window.rcEditor.fillFields(l => l === 'Nombre' ? 'Ana Rodríguez' : null);
  check('al rellenar el campo conserva su formato', campoF().textContent === 'Ana Rodríguez' && /Arial/.test(getComputedStyle(campoF()).fontFamily));
  selTodo(); await wait();
  $('[data-command="removeFormat"]').click(); await wait();
  check('"Quitar formato" también lo quita del campo', !campoF().getAttribute('style'));
  // Un campo nuevo dentro de texto con otra fuente toma esa fuente
  window.rcEditor.loadHtml('<p><font face="Arial" size="5">Firma de </font></p>');
  await wait(200);
  const fontF = ed.querySelector('font');
  const rCur = document.createRange(); rCur.setStart(fontF.firstChild, fontF.firstChild.length); rCur.collapse(true);
  ed.focus(); window.getSelection().removeAllRanges(); window.getSelection().addRange(rCur); await wait();
  $('#btnInsertField').click(); await wait();
  $('#fieldLabel').value = 'Ciudad'; $('#fieldValue').value = 'Santo Domingo';
  $('#fieldSave').click(); await wait();
  check('campo nuevo con la fuente y el tamaño del texto', getComputedStyle(campoF()).fontFamily === getComputedStyle(fontF).fontFamily && getComputedStyle(campoF()).fontSize === getComputedStyle(fontF).fontSize);
  document.querySelector('[data-lib-tab="documentos"]').click(); await wait();

  // ---------- Ayuda: recorrido interactivo ----------
  check('botón de ayuda en la barra superior', !!$('#btnAyuda') && $('#btnAyuda').offsetParent !== null);
  $('#btnAyuda').click(); await wait();
  const tourMenu = document.querySelector('.tour-menu');
  check('menú de ayuda: completo, esta pantalla y por sección (sin Configuración)', !tourMenu.hidden && !!tourMenu.querySelector('[data-tour="todo"]') &&
    tourMenu.querySelectorAll('.tour-menu-grid button').length === window.rcTour.secciones.length && !window.rcTour.secciones.includes('configuracion') && !/Configuración/.test(tourMenu.textContent));
  tourMenu.querySelector('[data-tour="todo"]').click(); await wait();
  const capaTour = document.querySelector('.tour-capa');
  const cuentaTour = () => capaTour.querySelector('.tour-cuenta').textContent;
  const totalTour = parseInt(cuentaTour().split(' de ')[1], 10);
  check('el recorrido empieza y cierra el menú', !capaTour.hidden && tourMenu.hidden && cuentaTour().startsWith('1 de ') && totalTour > 30);
  const vistasTour = new Set(), sinFoco = [];
  for (let i = 0; i < totalTour; i++) {
    vistasTour.add(document.body.dataset.activeView);
    if (capaTour.querySelector('.tour-foco').classList.contains('sin-foco')) sinFoco.push(capaTour.querySelector('.tour-titulo').textContent + ' (' + document.body.dataset.activeView + ')');
    if (i < totalTour - 1) { document.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true })); await wait(60); }
  }
  check('recorre todas las pantallas menos Configuración', vistasTour.size === 15 && !vistasTour.has('configuracion'));
  check('cada paso resalta su elemento' + (sinFoco.length ? ' (sin foco: ' + sinFoco.join(', ') + ')' : ''), !sinFoco.length);
  const tarjetaTour = capaTour.querySelector('.tour-card').getBoundingClientRect();
  check('la tarjeta queda dentro de la ventana', tarjetaTour.left >= 0 && tarjetaTour.top >= 0 && tarjetaTour.right <= window.innerWidth && tarjetaTour.bottom <= window.innerHeight);
  check('el último paso dice "Terminar"', capaTour.querySelector('[data-tour-acc="siguiente"]').textContent === 'Terminar');
  capaTour.querySelector('[data-tour-acc="siguiente"]').click(); await wait();
  check('al terminar se cierra y no vuelve a llamar la atención', capaTour.hidden && !$('#btnAyuda').classList.contains('pulso') && localStorage.getItem('renthouse.tourVisto') === '1');
  $('.nav-item[data-view="cobros"]').click(); await wait();
  $('#btnAyuda').click(); await wait();
  tourMenu.querySelector('[data-tour="aqui"]').click(); await wait();
  check('"Esta pantalla" recorre solo Cobros', !capaTour.hidden && capaTour.querySelector('.tour-seccion').textContent === 'Cobros' && cuentaTour() === '1 de 4');
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await wait();
  check('Esc sale del recorrido', capaTour.hidden);
  check('pantallas sin párrafos de explicación', [...document.querySelectorAll('.view:not([data-view="configuracion"]) .mgmt-head p')].length === 0);

  // ---------- Licencia: plan "solo redactor" y "completo" ----------
  const gateLic = $('#licenseGate');
  const fetchReal = window.fetch;
  let respuestaLic = null;
  window.fetch = async (url, opts) => {
    if (!String(url).includes('workers.dev')) return fetchReal(url, opts);
    if (respuestaLic === 'sin-red') throw new TypeError('Failed to fetch');
    return { json: async () => respuestaLic };
  };
  localStorage.setItem('rc_device_id', 'equipo-prueba');
  const activarLic = async (clave, resp) => {
    respuestaLic = resp;
    gateLic.classList.remove('gate-hidden');
    $('#licenseKeyInput').value = clave;
    $('#licenseActivateBtn').click(); await wait(500);
  };
  const navVisibles = () => [...document.querySelectorAll('.side-nav .nav-item[data-view]')].filter(b => b.offsetParent !== null).map(b => b.dataset.view);
  const estadoLic = () => $('#licenseGateStatus').textContent;

  // El plan sale del token firmado, no de lo que diga la respuesta
  await activarLic('CLAVE-RED', { ok:true, plan:'completo', token: window.__TOKENS.redactor });
  check('licencia "redactor": abre solo el redactor', gateLic.classList.contains('gate-hidden') && document.body.dataset.plan === 'redactor' &&
    document.body.dataset.activeView === 'redactor' && navVisibles().join(',') === 'redactor,configuracion' && $('#btnBuscar').offsetParent === null);
  $('.nav-item[data-view="cobros"]').click(); await wait();
  check('no se puede entrar a la gestión', document.body.dataset.activeView === 'redactor');
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'k', ctrlKey:true, bubbles:true })); await wait();
  check('ni con la búsqueda (Ctrl+K)', !$('#buscarOverlay').classList.contains('show'));
  $('.nav-item[data-view="configuracion"]').click(); await wait(300);
  check('Configuración sin lo de gestión, con el papel', [...document.querySelectorAll('.solo-completo')].every(el => el.offsetParent === null) &&
    document.querySelector('[data-ajuste="papel"]').offsetParent !== null && document.querySelector('[data-ajuste="moneda"]').offsetParent === null &&
    document.querySelector('[data-ajuste="tema"], .cfg-swatch').offsetParent !== null);
  $('#btnAyuda').click(); await wait();
  check('la ayuda ofrece solo el redactor', [...document.querySelectorAll('.tour-menu-grid [data-tour]')].filter(b => !b.hidden).map(b => b.dataset.tour).join(',') === 'general,redactor');
  document.querySelector('.tour-menu [data-tour="todo"]').click(); await wait();
  check('recorrido del plan redactor: 9 pasos, sin búsqueda', document.querySelector('.tour-cuenta').textContent === '1 de 9');
  document.dispatchEvent(new KeyboardEvent('keydown', { key:'Escape', bubbles:true })); await wait();

  // Tokens que no valen
  const [cuerpoTok, firmaTok] = window.__TOKENS.redactor.split('.');
  const datosTok = JSON.parse(atob(cuerpoTok.replace(/-/g, '+').replace(/_/g, '/')));
  const tokFalso = btoa(JSON.stringify(Object.assign(datosTok, { p:'completo' }))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') + '.' + firmaTok;
  await activarLic('CLAVE-RED', { ok:true, plan:'completo', token: tokFalso });
  check('token manipulado: no abre', !gateLic.classList.contains('gate-hidden') && estadoLic().includes('firma válida'));
  await activarLic('CLAVE-RED', { ok:true, token: window.__TOKENS.ajeno });
  check('token de otro equipo: no abre', !gateLic.classList.contains('gate-hidden') && estadoLic().includes('firma válida'));
  await activarLic('CLAVE-RED', { ok:true, status:'verified' });
  check('servidor sin firma (Worker sin actualizar): no abre', !gateLic.classList.contains('gate-hidden'));
  await activarLic('CLAVE-RED', { ok:false, reason:'update_required' });
  check('licencia que pide actualizar el programa', estadoLic().includes('última versión'));

  // Sin internet: vale el último token firmado de las últimas 12 horas
  await activarLic('CLAVE-RED', { ok:true, token: window.__TOKENS.redactor });
  await activarLic('CLAVE-RED', 'sin-red');
  check('sin conexión, con token reciente: abre con su plan', gateLic.classList.contains('gate-hidden') && document.body.dataset.plan === 'redactor' && estadoLic().startsWith('Sin conexión'));
  localStorage.setItem('rc_license_token', window.__TOKENS.viejo);
  await activarLic('CLAVE-RED', 'sin-red');
  check('sin conexión, con token de más de 12 horas: no abre', !gateLic.classList.contains('gate-hidden') && estadoLic().startsWith('No se pudo conectar'));

  // Licencia completa: vuelve todo
  await activarLic('CLAVE-COMP', { ok:true, plan:'completo', token: window.__TOKENS.completo });
  check('licencia "completa": todo el menú', gateLic.classList.contains('gate-hidden') && document.body.dataset.plan === 'completo' && navVisibles().length === 16 && $('#btnBuscar').offsetParent !== null);
  $('.nav-item[data-view="cobros"]').click(); await wait();
  check('y se puede entrar a la gestión', document.body.dataset.activeView === 'cobros');
  window.fetch = fetchReal;
  ['rc_license_key', 'rc_license_token'].forEach(k => localStorage.removeItem(k));

  // Vista estrecha
  check('sin scroll horizontal', document.documentElement.scrollWidth <= window.innerWidth);

  } catch (err) {
    log.push('FALLA excepción en los pasos: ' + err.message + ' | ' + String(err.stack || '').split('\n').slice(1, 3).join(' '));
  }
  return { log };
})();
