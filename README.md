# Redactor de Contratos — App de escritorio (Electron)

Este proyecto envuelve tu `editor-contratos.html` en una app de escritorio con Electron,
sin modificar la lógica interna (verificación de licencia contra tu Worker, payload
cifrado con AES-256-GCM, etc.). Todo eso funciona igual porque Electron usa Chromium
por dentro: `fetch`, `localStorage`, `crypto.subtle` y la File System Access API
(`showDirectoryPicker`, usada por "Elegir carpeta de guardado") funcionan sin cambios.

## Estructura

```
redactor-contratos-electron/
├── main.js            # Proceso principal: crea la ventana
├── preload.js          # Script de precarga (aislado, sin exponer Node)
├── package.json         # Dependencias y configuración de empaquetado
└── renderer/
    └── index.html      # Tu editor-contratos.html tal cual
```

## Gestión de alquileres

Además del redactor, la app tiene un menú lateral para llevar el control de los
inmuebles que administra el despacho:

- **Resumen**: ocupación, alquiler mensual de los contratos activos y contratos
  vencidos o que vencen en los próximos 30 días.
- **Edificios**: nombre, dirección y propietario (arrendador).
- **Apartamentos**: unidades de cada edificio, con su estado (disponible/ocupado)
  y el inquilino actual.
- **Inquilinos**: datos personales y una ficha con todos sus contratos.
- **Contratos**: unen un inquilino con un apartamento durante un periodo. Un
  apartamento solo puede tener un contrato activo; al finalizarlo queda libre y
  el contrato se conserva en el historial.

**Finanzas** (en el menú lateral):

- **Cobros**: cada contrato genera una cuota por mes, que vence el "día de pago".
  Para el mes elegido se ve cuánto se esperaba, cuánto se cobró, qué cuotas están
  atrasadas y la deuda acumulada de cada inquilino. Se pueden registrar pagos
  completos o abonos parciales, y cada pago tiene un **recibo numerado** que se
  imprime desde el navegador.
- **Gastos**: reparaciones de un apartamento o gastos de áreas comunes (luz, agua,
  internet, limpieza, seguridad...), con proveedor y número de factura. "Repetir"
  copia un gasto con la fecha de hoy, útil para servicios mensuales.
- **Propietarios y Liquidaciones**: cada edificio tiene un propietario (y un
  apartamento puede tener otro distinto) con su cuenta bancaria. Las liquidaciones
  son del abogado: cada edificio lleva la **comisión del abogado** (porcentaje de lo
  cobrado o monto fijo por apartamento alquilado), y un apartamento puede tener una
  propia que reemplaza la del edificio. Cada mes, Liquidaciones calcula por edificio,
  propietario y moneda la comisión de cada apartamento y lo que queda para el
  propietario: lo cobrado − la comisión (− los gastos, si ese edificio los descuenta;
  se elige por edificio en Configuración). Se registra la liquidación (queda una foto
  de los importes y se avisa si después cambian) y se imprime con el desglose por
  apartamento, los pagos y los gastos.
- **Balance**: ingresos cobrados frente a gastos por mes, por año, moneda y
  edificio, con gastos por categoría. Los ingresos se cuentan por la fecha en que se
  cobró el pago. Los montos nunca se mezclan entre monedas.

**Ayuda** (botón "?" de la barra superior): recorrido interactivo por toda la aplicación (menos Configuración), completo, de la pantalla actual o por sección. La interfaz casi no lleva textos de explicación: la ayuda es el recorrido.

**Configuración** (al pie del menú lateral): apariencia (preferencias de este equipo: tema oscuro, claro o según Windows; color de acento; tamaño de la interfaz de 90% a 125%; densidad cómoda o compacta; fuente; animaciones; menú completo o recortado; y "Restablecer"); datos del
despacho, que aparecen en recibos, estados de cuenta y recordatorios; valores predeterminados
(moneda, día de pago, duración de los contratos, recargo por mora, comisión del abogado en
edificios nuevos, aviso de vencimiento, papel de impresión), que se guardan con los datos y entran en
los respaldos; qué edificios descuentan los gastos en su liquidación; carpeta de trabajo, respaldos, verificación con la JCE, PIN y actualizaciones.

**Ciclo del contrato** (menú "⋯" de cada contrato):

- **Varios inquilinos** por contrato (p. ej. una pareja) y **fiador** con sus datos.
- **Recargo por mora**: porcentaje de la cuota o monto fijo, tras unos días de gracia.
  Se cobra una vez por cuota si no se pagó completa a tiempo; se puede condonar por mes
  desde Cobros.
- **Renovar**: crea el contrato siguiente con el aumento indicado y finaliza el actual;
  el depósito pasa al contrato nuevo.
- **Depósito**: fecha de recepción y, al terminar, lo devuelto y lo retenido (con
  motivo). Lo retenido se puede aplicar a la deuda: se registra como pagos de las
  cuotas vencidas más antiguas.

**Cobro y gestión legal**:

- **Estado de cuenta del inquilino** imprimible, mes por mes (cuota, recargo, pagado,
  saldo) con la deuda vencida: base para una intimación de pago.
- **Recordatorio de pago** por WhatsApp o correo, con el mensaje ya redactado.
- **Expediente** en la ficha del inquilino: notas de seguimiento con fecha (los
  recordatorios enviados se anotan solos) y archivos adjuntos, que se guardan en
  `<carpeta de trabajo>\Expedientes`.

**Cédulas y RNC**: en inquilinos, propietarios y fiadores se comprueba el dígito
verificador mientras se escribe (cédula de 11 dígitos con el algoritmo de la JCE; RNC de 9
con el de la DGII) y se guardan con su formato (`001-1234567-3`, `4-01-50625-4`). Si no
cumple, se pide confirmación en lugar de bloquear, porque algunas cédulas muy antiguas no
lo cumplen. Los documentos con letras se toman como pasaportes. Comprueba que el número
está bien escrito, no que pertenezca a esa persona: eso solo lo puede confirmar la JCE.

**Autocompletar por documento**: al escribir una cédula o un RNC que ya existe en tus
registros (inquilino, propietario o fiador), "Usar sus datos" rellena nombre, teléfono,
correo, domicilio, etc. Si es otro inquilino (o propietario) con el mismo documento, solo
avisa, para no duplicarlo.

**Verificación con la JCE (Didit)**: "Verificación JCE" en Inquilinos. Con una clave de API de
[Didit](https://didit.me) (cobra cada consulta con resultado y exige una primera recarga de saldo
para activar el servicio; "Probar clave" lo comprueba sin gastar consultas), bajo cada
cédula válida aparece "Verificar con la JCE": confirma si la cédula existe en el registro y, si
Didit devuelve el nombre, se usa para completar el formulario. La clave se guarda cifrada en el
equipo (solo la usa el proceso principal) y cada cédula verificada se recuerda para no gastar
otra consulta. La cédula solo se envía a Didit al pulsar el botón.

**Casos de cobro y desalojo** (menú Legal → Casos): desde un contrato con atraso, "Abrir caso de
cobro…" crea un caso con la deuda de ese momento. Cada caso avanza por etapas (intimación de pago,
demanda, audiencias, sentencia y ejecución); al pasar de etapa se anota el detalle en el historial y
se puede agendar la próxima fecha. Guarda tribunal, número de expediente y alguacil, y una lista de
requisitos que se marcan al reunirlos (contrato, certificación del depósito en el Banco Agrícola,
estado de cuenta, poder, intimación...); la lista es editable. "Redactar acto" abre un modelo del
Redactor rellenando, además de los datos del contrato, la deuda ("Deuda total", "Deuda en letras",
"Meses adeudados", "Detalle de la deuda"), "Tribunal", "Número de expediente" y "Alguacil"; el acto
se guarda como .doc aparte, sin reemplazar el documento del contrato. Al cerrar un caso se indica el
resultado (pago, acuerdo, desalojo...) y, si se quiere, se finaliza el contrato. Los montos en letras
siguen el formato de los actos: "VEINTICINCO MIL PESOS DOMINICANOS CON 00/100 (RD$ 25,000.00)".

**Agenda** (menú Legal → Agenda): calendario mensual con audiencias, plazos, citas y tareas, más los
vencimientos de contratos, que aparecen solos. La lista de la derecha agrupa lo pendiente (atrasado,
hoy, próximos 7 días y 30 días) y cada evento se marca como hecho. El Resumen avisa de lo de los
próximos 3 días, el menú cuenta lo pendiente de hoy o atrasado, y al abrir la aplicación se muestra un
aviso de Windows una vez al día si hay algo pendiente.

**Búsqueda global** (Ctrl+K o la barra de arriba): encuentra inquilinos, propietarios, edificios,
apartamentos, contratos, casos y recibos por nombre, cédula, teléfono, expediente o número;
con las flechas y Enter se abre la ficha.

**Recordatorios en lote** (Cobros → "Recordar a los atrasados"): todos los inquilinos con
atraso, cada uno con su mensaje listo para WhatsApp o correo; cada envío se marca y se anota
en el seguimiento. **"Enviar a todos"** manda los correos solos (con la cuenta de Configuración →
"Correo para recordatorios"; en Gmail, una contraseña de aplicación, guardada cifrada) y luego
abre los WhatsApp uno tras otro: se envía en WhatsApp, se vuelve y Enter abre el siguiente.
WhatsApp no permite envíos automáticos sin la API de pago de Meta. Nadie recibe dos veces lo mismo
en la misma sesión.

**Aumento del alquiler**: en el contrato, "Aumento anual (%)" y cada cuántos meses. El Resumen
y la Agenda avisan antes del aniversario, y "Aplicar aumento…" (menú del contrato) guarda el
nuevo monto desde el mes indicado sin cambiar las cuotas anteriores, y prepara el aviso al
inquilino.

**Impuestos**: por contrato, "ITBIS sobre el alquiler (%)" (locales comerciales; se suma a
cada cuota) y "Retención de ISR del inquilino (%)" (empresas que retienen ISR: al registrar el
pago se propone lo retenido, que cuenta como pagado). En las liquidaciones el ISR retenido se
muestra aparte y no se transfiere, y en Configuración se puede indicar el ITBIS sobre la
comisión del abogado. Los porcentajes los decide el usuario; conviene confirmarlos con el
contador.

**Liquidaciones del mes a los propietarios** (Liquidaciones → "Enviar a propietarios"): una por
edificio y propietario, para guardar en PDF o enviar un resumen por WhatsApp o correo; "Todos en un PDF"
los junta. En los primeros 10 días del mes el Resumen avisa de los que faltan por enviar.

**Mantenimiento**: solicitudes de reparación por apartamento o áreas comunes, con prioridad,
responsable y estado. Al resolverlas se puede registrar el costo en Gastos (categoría
Reparación). Las urgentes y de prioridad alta aparecen en el Resumen.

**Acta de entrega y devolución** (menú del contrato): inventario del inmueble por áreas con el
estado de cada elemento, lecturas de luz, agua y gas, llaves, observaciones y fotos (que se
guardan en el expediente del inquilino). El acta de devolución parte de la de entrega y marca
lo que está peor; desde ahí se abre el depósito para descontar desperfectos. Se imprime con
espacio para las firmas.

**PDF**: el Redactor tiene un botón "PDF", los recibos se pueden guardar en PDF desde su menú,
y en Configuración se puede elegir que los recibos y estados de cuenta se guarden siempre como
PDF (por defecto en `<carpeta de trabajo>\PDF`) en lugar de abrirse en el navegador.

**Reportes**: morosidad por antigüedad (1–30, 31–60, 61–90 y más de 90 días),
depósitos en custodia y **exportación a Excel** (`.xlsx`, una hoja por tema, incluidos casos y agenda) para el
contador.

**PIN de acceso** (al pie del menú): pide un PIN al abrir la aplicación y tras un rato
sin uso. Si se olvida, se desbloquea con la clave de licencia. Es un control de acceso,
no cifra los datos.

**Redactor y carpeta de trabajo**: en el Redactor se elige una carpeta de trabajo
(se recuerda entre sesiones). Ahí se guarda cada versión de los documentos
(`.doc`, con fecha y hora en el nombre) y, en la subcarpeta `Modelos`, los modelos
reutilizables como archivos `.html`. La biblioteca de la izquierda muestra ambos
para abrirlos, imprimirlos o usarlos. Borrar un modelo lo manda a la papelera. Los
modelos que versiones anteriores guardaban dentro de la app se mueven solos a
`Modelos` la primera vez que hay una carpeta elegida.

**Espacio de trabajo del redactor**: ocupa toda la altura de la ventana. El panel
lateral (se puede ocultar) tiene tres pestañas: Documentos, Modelos y Campos. En
Campos, los campos repetidos se agrupan (×N); al editar uno se puede aplicar el
valor a todos los del mismo nombre, y los que faltan por completar se marcan. La
documento se ve **como en Word: hojas separadas** del tamaño real del papel (Carta,
A4, Oficio...; vertical u horizontal) con los **márgenes** elegidos en el pie
(estrechos, moderados, 2 cm, los de Word o amplios). Un párrafo que no cabe pasa
entero a la hoja siguiente, y al imprimir, en el PDF y en el `.doc` se usan el
mismo papel, márgenes, tipografía y regla, así que cada hoja sale como se ve. El pie
indica palabras y páginas, con zoom y "Ajustar" al ancho. La barra de formato incluye
estilos de párrafo, tachado, justificado, sangría, quitar formato, salto de página e
**interlineado**: 1,0 a 3,0, "Juntar/Separar líneas" de a 0,1, espacio entre
párrafos (ninguno, pequeño, normal, amplio) y "Quitar líneas vacías" (renglones en
blanco y saltos dobles), para lo seleccionado o todo el documento. Atajos: Ctrl+S
guarda el `.doc`, Ctrl+P imprime, y Ctrl+1 / Ctrl+5 / Ctrl+2 ponen interlineado
sencillo, 1,5 o doble.

**Documento del contrato**: desde un contrato, "Redactar" abre el redactor con un
modelo guardado y rellena solos los campos cuyo nombre coincide con un dato del
contrato ("Nombre del inquilino", "Cédula", "Apartamento", "Monto del alquiler",
"Fecha de inicio", "Nombre del propietario"...). Al insertar un campo, el editor
sugiere estos nombres. "Guardar en el contrato" guarda el documento dentro del
contrato para volver a abrirlo después.

**Dónde se guardan los datos**: en `renthouse-datos.json`, dentro de la carpeta de
datos de la app (en Windows, `%APPDATA%\<NombreApp>\`, la misma carpeta de `debug.log`), con una copia de la
versión anterior en `renthouse-datos.json.bak`. Además hay un **respaldo automático
diario** en `<carpeta de trabajo>\Respaldos` (se conservan 30 días; si aún no hay
carpeta de trabajo, en la carpeta de datos de la app). Su estado se ve al pie del menú
lateral, y cualquiera de ellos se restaura con "Importar respaldo". "Exportar respaldo" descarga todo
en un archivo JSON, e "Importar respaldo" lo restaura (reemplaza los datos actuales).

## Licencias y planes

Cada licencia tiene un plan: **completo** (toda la aplicación) o **redactor** (solo el
redactor de contratos y Configuración, sin nada de gestión). El servidor de licencias
(`servidor-licencias/worker.js`, un Cloudflare Worker) devuelve el plan firmado con
Ed25519 y la app lo comprueba con `licencia-publica.pem`, así que no se puede cambiar
editando nada en el equipo del cliente. Sin internet, la app abre con el último plan
firmado durante 12 horas.

- **Alta:** en Workers KV, clave = la licencia; valor `{}` (completo) o
  `{"plan":"redactor"}`.
- **Cambiar de plan:** edita su valor y añade o cambia `"plan"` sin borrar su
  `deviceId`. Se aplica la próxima vez que abra el programa.
- **Claves de firma:** `node servidor-licencias/generar-claves.js` (una sola vez).
  La privada va como secreto `LICENSE_SIGNING_KEY` del Worker y no se sube a git.
- **Orden al publicar:** primero el Worker nuevo; después la app. La app nueva rechaza
  respuestas sin firma.

Las herramientas de desarrollo (Ctrl+Shift+I) solo se abren sin empaquetar.

## Requisitos

- [Node.js](https://nodejs.org) 18 o superior instalado en tu máquina.

## Cómo probarla en desarrollo

```bash
cd redactor-contratos-electron
npm install
npm start
```

Esto abre la app en una ventana de escritorio. Como sigue llamando a tu Worker de
Cloudflare (`WORKER_URL` dentro del HTML) para verificar la licencia, necesitas
conexión a internet la primera vez (después, la tolerancia offline de 12 horas
que ya tenías en el código sigue funcionando igual).

## Pruebas

```bash
npm run test:e2e
```

Abre la aplicación sin mostrar la ventana, con datos y carpeta de trabajo temporales
(no toca tus datos), y la recorre con clics simulados: edificios, contratos, cobros,
liquidaciones, redactor, PIN, exportación... Lo que saldría de la aplicación (imprimir,
diálogos, WhatsApp) se intercepta. Termina con código 1 si algo falla. Los pasos están en
`tests/e2e/pasos.js`.

Si la terminal tiene la variable `ELECTRON_RUN_AS_NODE` definida (pasa en la de algunos
editores), quítala antes de ejecutar la prueba.

## Cómo generar el instalador/ejecutable

```bash
npm run dist         # detecta tu sistema operativo automáticamente
npm run dist:win      # instalador .exe (NSIS) — normalmente se genera desde Windows
npm run dist:mac      # .dmg — solo se puede generar desde macOS
npm run dist:linux    # AppImage
```

Los archivos generados quedan en la carpeta `dist/`.

> Nota: para generar un `.exe` firmado o un `.dmg` notarizado necesitas compilar
> desde el sistema operativo correspondiente (Windows para `.exe`, macOS para
> `.dmg`) o usar un servicio de CI multiplataforma. Sin firma/notarización, el
> instalador funciona igual pero Windows/macOS pueden mostrar una advertencia de
> "editor desconocido" la primera vez que se abre.

## Icono de la app (opcional)

Si quieres un ícono propio, agrega:
- `build/icon.ico` (Windows, 256x256)
- `build/icon.icns` (macOS)
- `build/icon.png` (Linux, 512x512)

y añade en `package.json`, dentro de cada bloque (`win`, `mac`, `linux`):
```json
"icon": "build/icon.ico"
```
(o `.icns` / `.png` según corresponda).

## Auto-actualización (GitHub Releases)

La app tiene un botón "Buscar actualizaciones" en la barra superior. Al apretarlo,
revisa si hay una versión nueva publicada en GitHub Releases, la descarga y
reinicia la app para instalarla, todo sin que el cliente tenga que reinstalar
nada a mano.

### Configuración inicial (una sola vez)

1. Crea un repositorio en GitHub (puede ser privado o público).
2. En `package.json`, dentro de `build.publish`, reemplaza:
   ```json
   "owner": "TU-USUARIO-DE-GITHUB",
   "repo": "TU-REPOSITORIO"
   ```
   por tu usuario y el nombre real del repo.
3. Crea un [token de acceso personal](https://github.com/settings/tokens) en GitHub
   con permiso `repo` (o `public_repo` si el repositorio es público).
4. En PowerShell, antes de publicar, define el token como variable de entorno
   (solo dura esa sesión de PowerShell):
   ```powershell
   $env:GH_TOKEN = "el_token_que_generaste"
   ```

### Publicar una versión nueva

1. Sube el código del repositorio a GitHub (`git push`), si aún no lo has hecho.
2. Sube la versión en `package.json` (por ejemplo de `"1.0.0"` a `"1.0.1"`).
3. Corre:
   ```powershell
   npm run release
   ```
   Esto compila el instalador y lo sube automáticamente como un GitHub Release
   (junto con el archivo `latest.yml` que electron-updater necesita para saber
   cuál es la última versión).
4. Listo. La próxima vez que un cliente apriete "Buscar actualizaciones", la
   app detecta la nueva versión, la descarga y se reinicia sola con la
   actualización instalada.

### Notas importantes

- **La primera instalación siempre es manual**: el cliente instala la versión
  1.0.0 con el instalador que tú le compartas. El botón de actualizar solo
  sirve para pasar de una versión ya instalada a la siguiente.
- **En modo desarrollo (`npm start`) el botón no hace nada real** — muestra
  "(modo desarrollo: sin auto-actualización)". El sistema de auto-actualización
  solo funciona sobre la app ya empaquetada e instalada.
- **Windows sin firma de código**: sin certificado de firma, Windows puede
  mostrar una advertencia de "editor desconocido" en la instalación inicial
  (igual que ya te pasaba). Las actualizaciones automáticas posteriores no
  vuelven a mostrar esa advertencia porque no pasan por el instalador de
  Windows, sino por electron-updater directamente.
- **Repositorio privado vs público**: si el repo es **público**, la app de tus
  clientes descarga las actualizaciones sin ningún token, sin problema. Si el
  repo es **privado**, electron-updater necesita un token para que la app
  instalada pueda leer los releases — y ese token tendría que quedar embebido
  dentro de la app, lo cual no es buena práctica (cualquiera podría extraerlo
  de tu instalador y acceder a tu repo). Para este caso, lo más simple es usar
  un repositorio público solo para alojar los releases (sin tu código fuente
  dentro, si te preocupa exponerlo), o migrar a hosting propio/S3 más adelante.
  El `GH_TOKEN` que defines en el paso de configuración es solo para que **tú**
  puedas publicar, no lo usan los clientes.

## Seguridad

La ventana usa `contextIsolation: true` y `nodeIntegration: false`, que es la
configuración recomendada por Electron. El `preload.js` no expone ninguna API de
Node al editor: tu app sigue funcionando exactamente como en el navegador.

## Si algo no carga (pantalla en blanco, licencia no valida)

1. Abre las herramientas de desarrollo (menú **Ver → Herramientas de desarrollo**,
   visible solo en modo desarrollo con `npm start`) y revisa la consola.
2. Confirma que `WORKER_URL` dentro de `renderer/index.html` sigue apuntando a tu
   Cloudflare Worker y que responde con CORS habilitado (por defecto los Workers
   sí lo permiten, pero si el tuyo restringe orígenes, en Electron el origen de la
   página es `file://`, así que puede que necesites permitir ese origen o quitar
   la restricción de origen en el Worker).
