(function(){
  // ---------------------------------------------------------------
  // PIN de acceso: bloquea la aplicación al abrirla, tras un rato sin
  // uso o a pedido. El PIN no se guarda: se guarda su derivación PBKDF2
  // (SHA-256, sal aleatoria) en localStorage de este equipo.
  //
  // Es un control de acceso, no cifrado: los datos siguen en disco sin
  // cifrar. Si se olvida el PIN, se puede desbloquear con la clave de
  // licencia de la aplicación (y entonces se quita el PIN).
  // ---------------------------------------------------------------
  const ui = window.rcUI;
  const $ = (id) => document.getElementById(id);

  const KEY = 'renthouse.pin';
  const ITERACIONES = 150000;
  const MAX_INTENTOS = 5;
  const ESPERA_MS = 30000;

  const lockEl = $('pinLock');
  const lockInput = $('pinLockInput');
  const lockBtn = $('pinLockBtn');
  const lockStatus = $('pinLockStatus');
  const lockMsg = $('pinLockMsg');
  const forgotBtn = $('pinForgot');
  const setupOverlay = $('pinSetupOverlay');
  const btnLockNow = $('btnLockNow');

  let locked = false;
  let modoLicencia = false;
  let fallos = 0;
  let esperaHasta = 0;
  let ultimaActividad = Date.now();

  function config(){
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return v && v.hash && v.salt ? v : null;
    } catch (err) {
      return null;
    }
  }

  const toB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const fromB64 = (s) => Uint8Array.from(atob(s), ch => ch.charCodeAt(0));

  async function derivar(pin, sal, iteraciones){
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt: sal, iterations: iteraciones, hash:'SHA-256' }, key, 256);
    return toB64(bits);
  }

  async function pinCorrecto(pin){
    const cfg = config();
    if (!cfg) return true;
    return (await derivar(pin, fromB64(cfg.salt), cfg.iter || ITERACIONES)) === cfg.hash;
  }

  async function guardarPin(pin, autoMin){
    const sal = crypto.getRandomValues(new Uint8Array(16));
    localStorage.setItem(KEY, JSON.stringify({ salt: toB64(sal), iter: ITERACIONES, hash: await derivar(pin, sal, ITERACIONES), autoMin }));
  }

  // Mientras está bloqueado, nada más de la página recibe foco ni clics.
  function setInert(valor){
    [...document.body.children].forEach(el => {
      if (el !== lockEl && el.id !== 'licenseGate' && el.tagName !== 'SCRIPT') el.inert = valor;
    });
  }

  function actualizarBotones(){
    btnLockNow.hidden = !config();
  }

  function setModoLicencia(valor){
    modoLicencia = valor;
    lockInput.value = '';
    lockInput.placeholder = valor ? 'Clave de licencia' : 'PIN';
    lockInput.setAttribute('inputmode', valor ? 'text' : 'numeric');
    lockMsg.textContent = valor ? 'Escribe la clave de licencia de la aplicación. Se quitará el PIN y podrás crear uno nuevo.' : 'Introduce tu PIN para continuar.';
    forgotBtn.textContent = valor ? 'Volver a usar el PIN' : '¿Olvidaste el PIN? Usa tu clave de licencia';
    lockStatus.textContent = '';
    lockInput.focus();
  }

  function lock(){
    if (!config() || locked) return;
    locked = true;
    document.querySelectorAll('.overlay.show').forEach(o => o.classList.remove('show'));
    setModoLicencia(false);
    lockEl.hidden = false;
    setInert(true);
    lockInput.focus();
  }

  function unlock(){
    locked = false;
    fallos = 0;
    lockEl.hidden = true;
    lockInput.value = '';
    lockStatus.textContent = '';
    setInert(false);
    ultimaActividad = Date.now();
  }

  async function intentar(){
    const valor = lockInput.value;
    if (!valor) return;
    if (Date.now() < esperaHasta) {
      lockStatus.className = 'license-status err';
      lockStatus.textContent = 'Demasiados intentos. Espera ' + Math.ceil((esperaHasta - Date.now()) / 1000) + ' segundos.';
      return;
    }
    lockBtn.disabled = true;
    try {
      if (modoLicencia) {
        let clave = '';
        try { clave = localStorage.getItem('rc_license_key') || ''; } catch (err) { /* sin clave guardada */ }
        if (clave && valor.trim() === clave.trim()) {
          localStorage.removeItem(KEY);
          unlock();
          actualizarBotones();
          ui.showNotice('Se quitó el PIN de acceso. Puedes crear uno nuevo en "PIN de acceso", al pie del menú.', 'PIN eliminado');
          return;
        }
      } else if (await pinCorrecto(valor)) {
        unlock();
        return;
      }
      fallos++;
      lockInput.value = '';
      lockStatus.className = 'license-status err';
      if (fallos >= MAX_INTENTOS) {
        esperaHasta = Date.now() + ESPERA_MS;
        fallos = 0;
        lockStatus.textContent = 'Demasiados intentos. Espera 30 segundos.';
      } else {
        lockStatus.textContent = modoLicencia ? 'Esa no es la clave de licencia de este equipo.' : 'PIN incorrecto.';
      }
      lockInput.focus();
    } finally {
      lockBtn.disabled = false;
    }
  }

  lockBtn.addEventListener('click', intentar);
  lockInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') intentar(); });
  forgotBtn.addEventListener('click', () => setModoLicencia(!modoLicencia));
  btnLockNow.addEventListener('click', lock);

  // Bloqueo por inactividad.
  ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { if (!locked) ultimaActividad = Date.now(); }, { passive:true, capture:true }));
  setInterval(() => {
    const cfg = config();
    if (!cfg || locked || !(Number(cfg.autoMin) > 0)) return;
    if (Date.now() - ultimaActividad > Number(cfg.autoMin) * 60000) lock();
  }, 15000);

  // ---------- Configurar el PIN ----------
  function abrirConfiguracion(){
    const cfg = config();
    $('pinCurrentWrap').hidden = !cfg;
    $('pinRemove').hidden = !cfg;
    $('pinNewLabel').textContent = cfg ? 'PIN nuevo (déjalo vacío para mantener el actual)' : 'PIN nuevo (4 a 12 dígitos)';
    ['pinCurrent', 'pinNew', 'pinNew2'].forEach(id => { $(id).value = ''; });
    $('pinAuto').value = String(cfg ? (cfg.autoMin || 0) : 15);
    setupOverlay.classList.add('show');
    (cfg ? $('pinCurrent') : $('pinNew')).focus();
  }

  async function guardarConfiguracion(){
    const cfg = config();
    const actual = $('pinCurrent').value;
    const nuevo = $('pinNew').value;
    const repetido = $('pinNew2').value;
    const autoMin = Number($('pinAuto').value) || 0;
    if (cfg && !(await pinCorrecto(actual))) {
      await ui.showNotice('El PIN actual no es correcto.', 'PIN de acceso');
      $('pinCurrent').focus();
      return;
    }
    if (!cfg || nuevo) {
      if (!/^\d{4,12}$/.test(nuevo)) {
        await ui.showNotice('El PIN debe tener entre 4 y 12 dígitos (solo números).', 'PIN de acceso');
        $('pinNew').focus();
        return;
      }
      if (nuevo !== repetido) {
        await ui.showNotice('Los dos PIN nuevos no coinciden.', 'PIN de acceso');
        $('pinNew2').focus();
        return;
      }
      await guardarPin(nuevo, autoMin);
    } else {
      localStorage.setItem(KEY, JSON.stringify(Object.assign({}, cfg, { autoMin })));
    }
    setupOverlay.classList.remove('show');
    actualizarBotones();
    await ui.showNotice(cfg && !nuevo ? 'Se guardó el tiempo de bloqueo.' : 'PIN guardado. Se pedirá al abrir la aplicación' +
      (autoMin ? ' y tras ' + autoMin + ' minutos sin uso.' : '.'), 'PIN de acceso');
  }

  async function quitarPin(){
    if (!(await pinCorrecto($('pinCurrent').value))) {
      await ui.showNotice('Escribe el PIN actual para poder quitarlo.', 'PIN de acceso');
      $('pinCurrent').focus();
      return;
    }
    localStorage.removeItem(KEY);
    setupOverlay.classList.remove('show');
    actualizarBotones();
    await ui.showNotice('Se quitó el PIN de acceso.', 'PIN de acceso');
  }

  $('btnPinSettings').addEventListener('click', abrirConfiguracion);
  $('pinSetupCancel').addEventListener('click', () => setupOverlay.classList.remove('show'));
  $('pinSetupSave').addEventListener('click', guardarConfiguracion);
  $('pinRemove').addEventListener('click', quitarPin);
  ['pinCurrent', 'pinNew', 'pinNew2'].forEach(id => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') guardarConfiguracion(); }));

  actualizarBotones();
  lock();

  window.rcSeguridad = { lock, isLocked: () => locked };
})();
