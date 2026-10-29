// ---------------------------------------------------------------
// Genera el par de claves con el que el servidor de licencias firma
// el plan de cada cliente (Ed25519). Se usa una sola vez:
//
//   node servidor-licencias/generar-claves.js
//
// Crea dos archivos:
//  - licencia-publica.pem (en la raíz del proyecto): va DENTRO de la app
//    y sirve para comprobar las firmas. No es secreta.
//  - servidor-licencias/clave-privada.json: se pega en el Worker como
//    secreto LICENSE_SIGNING_KEY y después se borra del equipo. Con ella
//    se pueden fabricar licencias: no la compartas ni la subas a git.
//
// Si ya existen, no se sobrescriben (cambiar las claves invalida los
// tokens de todos los clientes hasta que vuelvan a conectarse).
// ---------------------------------------------------------------
const { generateKeyPairSync } = require('crypto');
const fs = require('fs');
const path = require('path');

const publica = path.join(__dirname, '..', 'licencia-publica.pem');
const privada = path.join(__dirname, 'clave-privada.json');
const forzar = process.argv.includes('--forzar');

if (!forzar && (fs.existsSync(publica) || fs.existsSync(privada))) {
  console.error('Ya existen las claves. Usa --forzar solo si quieres reemplazarlas.');
  process.exit(1);
}

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
fs.writeFileSync(publica, publicKey.export({ type: 'spki', format: 'pem' }));
fs.writeFileSync(privada, JSON.stringify(privateKey.export({ format: 'jwk' })), { mode: 0o600 });
console.log('Clave pública:  ' + publica);
console.log('Clave privada:  ' + privada + '  (pégala en el Worker como LICENSE_SIGNING_KEY y bórrala)');
