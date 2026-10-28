// Apariencia de la aplicación (Configuración → Apariencia).
// Se carga en el <head> para aplicar todo antes de pintar y evitar parpadeos.
// Son preferencias de este equipo: se guardan en localStorage, no en los datos.
(function(){
  const TEMA_KEY = 'redactorContratos.tema';   // 'dark' | 'light' | 'system'
  const AP_KEY = 'renthouse.apariencia';       // { acento, escala, densidad, fuente, animaciones }
  const MENU_KEY = 'renthouse.menuRecortado';

  const PREDETERMINADA = { tema: 'dark', acento: 'azul', escala: '1', densidad: 'comoda', fuente: 'plex', animaciones: 'si' };
  const VALORES = {
    tema: ['dark', 'light', 'system'],
    acento: ['azul', 'turquesa', 'violeta', 'vino', 'dorado', 'grafito'],
    escala: ['0.9', '1', '1.1', '1.25'],
    densidad: ['comoda', 'compacta'],
    fuente: ['plex', 'sistema', 'serif'],
    animaciones: ['si', 'no']
  };

  const root = document.documentElement;
  const sistemaClaro = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;

  function leer(){
    const ap = Object.assign({}, PREDETERMINADA);
    try {
      Object.assign(ap, JSON.parse(localStorage.getItem(AP_KEY) || '{}'));
      ap.tema = localStorage.getItem(TEMA_KEY) || PREDETERMINADA.tema;
    } catch (err) { /* sin localStorage: valores predeterminados */ }
    Object.keys(VALORES).forEach(k => { if (!VALORES[k].includes(String(ap[k]))) ap[k] = PREDETERMINADA[k]; });
    return ap;
  }

  function guardar(ap){
    try {
      localStorage.setItem(TEMA_KEY, ap.tema);
      const resto = Object.assign({}, ap);
      delete resto.tema;
      localStorage.setItem(AP_KEY, JSON.stringify(resto));
    } catch (err) { /* no crítico */ }
  }

  function temaEfectivo(tema){
    if (tema === 'system') return sistemaClaro && sistemaClaro.matches ? 'light' : 'dark';
    return tema === 'light' ? 'light' : 'dark';
  }

  function aplicar(ap){
    root.setAttribute('data-theme', temaEfectivo(ap.tema));
    root.setAttribute('data-acento', ap.acento);
    root.setAttribute('data-fuente', ap.fuente);
    root.classList.toggle('densidad-compacta', ap.densidad === 'compacta');
    root.classList.toggle('sin-animaciones', ap.animaciones === 'no');
    if (window.rcApp && window.rcApp.setZoom) window.rcApp.setZoom(Number(ap.escala));
  }

  let actual = leer();
  aplicar(actual);
  try { if (localStorage.getItem(MENU_KEY) === '1') root.classList.add('nav-collapsed'); } catch (err) { /* no crítico */ }

  // Con "Según el sistema", sigue los cambios de Windows sin reiniciar.
  if (sistemaClaro) {
    const alCambiar = () => { if (actual.tema === 'system') aplicar(actual); };
    if (sistemaClaro.addEventListener) sistemaClaro.addEventListener('change', alCambiar);
  }

  window.rcApariencia = {
    get: () => Object.assign({}, actual),
    temaEfectivo: () => temaEfectivo(actual.tema),
    set(clave, valor){
      if (!VALORES[clave] || !VALORES[clave].includes(String(valor))) return;
      actual[clave] = String(valor);
      guardar(actual);
      aplicar(actual);
    },
    reset(){
      actual = Object.assign({}, PREDETERMINADA);
      guardar(actual);
      aplicar(actual);
    }
  };
})();
