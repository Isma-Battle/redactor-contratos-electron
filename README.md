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
