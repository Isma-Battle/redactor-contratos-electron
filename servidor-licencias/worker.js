// ---------------------------------------------------------------
// Servidor de licencias (Cloudflare Worker) para RentHouse
//
// Qué hace:
//  - Recibe { licenseKey, deviceId, appVersion } desde el programa.
//  - Si la clave no existe en el almacén (KV) -> la rechaza.
//  - Si la clave existe y todavía no está ligada a ningún equipo
//    -> la liga a ese "deviceId" (primer uso = activación) y la acepta.
//  - Si la clave ya está ligada a un deviceId igual al que llega
//    -> la acepta (es el mismo equipo).
//  - Si la clave ya está ligada a OTRO deviceId -> la rechaza
//    ("en uso en otro equipo").
//  - Cuando la acepta, devuelve el PLAN de la licencia y un TOKEN
//    firmado con ese plan, para que nadie pueda cambiárselo en su equipo:
//      "completo" -> toda la aplicación (valor por defecto).
//      "redactor" -> solo el redactor de contratos.
//    También entrega la clave de descifrado del editor (DECRYPTION_KEY).
//
// Variables del Worker (Configuración / Settings -> Variables):
//  - LICENSES (KV namespace): las licencias. Igual que antes.
//  - DECRYPTION_KEY (secreto): igual que antes.
//  - LICENSE_SIGNING_KEY (secreto, NUEVO): pega aquí todo el contenido
//    del archivo servidor-licencias/clave-privada.json (empieza por
//    {"crv":"Ed25519"...). Marca "Cifrar" (Encrypt). Después borra ese
//    archivo de tu equipo.
//
// Cómo dar de alta una licencia (Workers KV -> namespace -> Add entry):
//  - Clave (Key): la clave que le das al cliente, p. ej. ACME-2026.
//  - Valor (Value):
//      {}                    -> licencia completa
//      {"plan":"redactor"}   -> solo el redactor
//
// Cambiar el plan de un cliente que ya activó: abre su entrada y añade o
// cambia "plan" SIN borrar su deviceId, por ejemplo:
//   {"deviceId":"…","activatedAt":"…","plan":"redactor"}
// Se aplica la próxima vez que abra el programa.
//
// Si el cliente cambia de equipo legítimamente: deja el valor solo con su
// plan ({} o {"plan":"redactor"}) para que se active en el nuevo equipo.
//
// Versiones antiguas del programa no saben limitarse al redactor: a una
// licencia "redactor" se le pide actualizar en vez de abrirse completa.
// ---------------------------------------------------------------

const PLANES = ['completo', 'redactor'];

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method !== 'POST') {
      return json({ ok: false, reason: 'method_not_allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      return json({ ok: false, reason: 'bad_request' }, 400);
    }

    const licenseKey = (body.licenseKey || '').toString().trim();
    const deviceId = (body.deviceId || '').toString().trim();
    if (!licenseKey || !deviceId) {
      return json({ ok: false, reason: 'missing_fields' }, 400);
    }

    const raw = await env.LICENSES.get(licenseKey);
    if (raw === null) {
      return json({ ok: false, reason: 'invalid_key' });
    }

    let record;
    try {
      record = JSON.parse(raw);
    } catch (err) {
      record = {};
    }
    const plan = PLANES.includes(record.plan) ? record.plan : 'completo';

    // Un programa antiguo (no manda appVersion) abriría todo: que actualice.
    if (plan !== 'completo' && !body.appVersion) {
      return json({ ok: false, reason: 'update_required' });
    }

    let status;
    if (!record.deviceId) {
      // Primera activación: esta licencia queda ligada a este equipo.
      record.deviceId = deviceId;
      record.activatedAt = new Date().toISOString();
      await env.LICENSES.put(licenseKey, JSON.stringify(record));
      status = 'activated';
    } else if (record.deviceId === deviceId) {
      // Mismo equipo que ya estaba activado.
      status = 'verified';
    } else {
      // Ligada a otro equipo distinto: se rechaza.
      return json({ ok: false, reason: 'in_use_elsewhere' });
    }

    let token;
    try {
      token = await firmar(env, { k: licenseKey, d: deviceId, p: plan, t: Date.now() });
    } catch (err) {
      return json({ ok: false, reason: 'server_misconfigured' }, 500);
    }
    return json({ ok: true, status, plan, token, decryptionKey: env.DECRYPTION_KEY });
  }
};

// Token = base64url(JSON) + "." + base64url(firma Ed25519 del JSON).
// El programa lo comprueba con la clave pública (licencia-publica.pem).
async function firmar(env, datos) {
  const jwk = JSON.parse(env.LICENSE_SIGNING_KEY);
  let clave;
  try {
    clave = await crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, false, ['sign']);
  } catch (err) {
    // Nombre antiguo del algoritmo en Workers.
    clave = await crypto.subtle.importKey('jwk', jwk, { name: 'NODE-ED25519', namedCurve: 'NODE-ED25519' }, false, ['sign']);
  }
  const bytes = new TextEncoder().encode(JSON.stringify(datos));
  const firma = await crypto.subtle.sign(clave.algorithm.name === 'Ed25519' ? 'Ed25519' : { name: 'NODE-ED25519' }, clave, bytes);
  return base64url(bytes) + '.' + base64url(new Uint8Array(firma));
}

function base64url(bytes) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() }
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
