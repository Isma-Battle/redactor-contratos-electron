// Lanza Electron en modo desarrollo (npm start).
//
// El terminal integrado de VS Code (y otras apps hechas con Electron)
// hereda la variable ELECTRON_RUN_AS_NODE=1. Con ella Electron arranca
// como un Node normal, require('electron') no trae app/BrowserWindow y la
// app falla al iniciar. Aquí se quita antes de lanzar Electron.

const { spawn } = require('child_process');
const path = require('path');
const electronPath = require('electron'); // desde Node, devuelve la ruta al ejecutable

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, [path.join(__dirname, '..')], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code == null ? 0 : code));
