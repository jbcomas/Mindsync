// MindSync web (PWA). JS vanilla. Todo el contenido del usuario se inserta con textContent (nunca innerHTML).
const $app = document.getElementById('app');

// ---------------------------------------------------------------- utilidades
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  return el;
};

async function api(path, { method = 'GET', body, raw, headers } = {}) {
  const res = await fetch(path, {
    method, credentials: 'same-origin',
    headers: raw ? headers : body ? { 'content-type': 'application/json' } : undefined,
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  if (res.status === 401) { state.me = null; render(); throw new Error('Sesión vencida'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(ERRORS[data.error] ?? `Error (${res.status})`);
  return data;
}
const ERRORS = {
  consent_required: 'Para reuniones tenés que confirmar que todos aceptaron la grabación.',
  no_speech: 'No se detectó voz en el audio.', empty_audio: 'El audio está vacío o es muy corto.', too_large: 'El archivo es demasiado grande.',
  llm_all_failed: 'El modelo de IA no respondió. Probá de nuevo en un momento.', llm_invalid_output: 'El modelo devolvió algo inválido. Probá de nuevo.',
  llm_unsupported: 'Falta configurar ese proveedor de IA.', invalid_request: 'Datos inválidos.', internal: 'Error interno.',
  registration_closed: 'El registro está cerrado: tu email no está en la lista de invitados. Si ya tenés cuenta, entrá con tu passkey o un código de recuperación.',
  login_failed: 'No se pudo iniciar sesión.', registration_failed: 'No se pudo crear la cuenta. Si ya tenías una, entrá con tu passkey o un código de recuperación.',
  too_many_attempts: 'Demasiados intentos. Esperá unos minutos.', challenge_expired: 'Se venció el intento. Probá de nuevo.',
  confirmation_mismatch: 'El email que escribiste no coincide con el de tu cuenta.', forbidden: 'Esa passkey no pertenece a esta cuenta.',
  workspace_shared: 'Tenés un espacio compartido con otras personas. Transferilo o dejalo antes de borrar la cuenta.', owns_shared_content: 'Tenés contenido tuyo dentro de un espacio ajeno. Resolvelo antes de borrar la cuenta.',
  invalid_or_expired: 'El enlace venció o ya se usó. Iniciá sesión y pedí uno nuevo desde el aviso de tu cuenta.', too_soon: 'Esperá un minuto antes de pedir otro correo.',
  already_verified: 'Tu email ya está verificado.', mail_failed: 'No pudimos enviar el correo. Probá de nuevo en un rato.', email_not_verified: 'Primero verificá tu email.',
  last_passkey: 'No podés borrar tu único passkey: perderías el acceso. Agregá otro primero.', already_registered: 'Ese dispositivo ya está registrado.',
};

let toastTimer;
function toast(msg) {
  document.querySelector('.toast')?.remove();
  document.body.append(h('div', { class: 'toast' }, msg));
  clearTimeout(toastTimer); toastTimer = setTimeout(() => document.querySelector('.toast')?.remove(), 4500);
}

const fmtDate = iso => iso ? new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
const TYPE = { idea: 'Idea', task: 'Tarea', decision: 'Decisión', person: 'Persona', project: 'Proyecto', concept: 'Concepto', event: 'Evento', organization: 'Organización' };
const SOURCE = { text: 'Nota', voice: 'Voz', audio: 'Audio', meeting: 'Reunión', document: 'Documento', web: 'Web', ai_conversation: 'Chat IA', import: 'Importado' };
const STATE = { unreviewed: ['Sin revisar', 'warn'], confirmed: ['Confirmado', 'ok'], corrected: ['Corregido', 'ok'], rejected: ['Rechazado', 'bad'] };
const EPI = { observation: 'observación', claim: 'afirmación', hypothesis: 'hipótesis', proposal: 'propuesta', decision_confirmed: 'decisión confirmada' };

// ---------------------------------------------------------------- estado
const state = { me: null, tab: 'capture', filter: 'unreviewed', items: null, sources: null, chat: [], busy: false, codes: null, pk: null, mustAdd: false, devLogin: false, mailDev: false, verifyToken: null };

// ---------------------------------------------------------------- WebAuthn (passkeys)
const b64uToBuf = s => { const p = s.replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(p + '='.repeat((4 - p.length % 4) % 4)), c => c.charCodeAt(0)).buffer; };
const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const creationOptions = j => ({ ...j, challenge: b64uToBuf(j.challenge), user: { ...j.user, id: b64uToBuf(j.user.id) }, excludeCredentials: (j.excludeCredentials ?? []).map(c => ({ ...c, id: b64uToBuf(c.id) })) });
const requestOptions = j => ({ ...j, challenge: b64uToBuf(j.challenge), allowCredentials: (j.allowCredentials ?? []).map(c => ({ ...c, id: b64uToBuf(c.id) })) });
function credentialToJSON(c) {
  const r = c.response, base = { id: c.id, rawId: bufToB64u(c.rawId), type: c.type, clientExtensionResults: c.getClientExtensionResults(), authenticatorAttachment: c.authenticatorAttachment ?? undefined };
  return r.attestationObject
    ? { ...base, response: { clientDataJSON: bufToB64u(r.clientDataJSON), attestationObject: bufToB64u(r.attestationObject), transports: r.getTransports?.() ?? [] } }
    : { ...base, response: { clientDataJSON: bufToB64u(r.clientDataJSON), authenticatorData: bufToB64u(r.authenticatorData), signature: bufToB64u(r.signature), userHandle: r.userHandle ? bufToB64u(r.userHandle) : undefined } };
}
/** El enlace del correo lleva el token en el fragmento (#verify=...), que el navegador no envía al servidor. */
const verifyTokenFromHash = hash => { const m = /^#verify=([A-Za-z0-9_-]{20,100})$/.exec(hash || ''); return m ? m[1] : null; };
const hasPasskeys = () => !!window.PublicKeyCredential && !!navigator.credentials;
function passkeyError(e) {
  if (e?.name === 'NotAllowedError') return new Error('Cancelaste o se agotó el tiempo. Probá de nuevo.');
  if (e?.name === 'InvalidStateError') return new Error('Ese dispositivo ya está registrado.');
  return e;
}
async function registerWithPasskey(email, name) {
  const options = await api('/api/auth/register/options', { method: 'POST', body: { email } });
  let cred; try { cred = await navigator.credentials.create({ publicKey: creationOptions(options) }); } catch (e) { throw passkeyError(e); }
  return api('/api/auth/register/verify', { method: 'POST', body: { response: credentialToJSON(cred), name } });
}
async function loginWithPasskey() {
  const options = await api('/api/auth/login/options', { method: 'POST' });
  let cred; try { cred = await navigator.credentials.get({ publicKey: requestOptions(options) }); } catch (e) { throw passkeyError(e); }
  return api('/api/auth/login/verify', { method: 'POST', body: { response: credentialToJSON(cred) } });
}
async function addPasskey(name) {
  const options = await api('/api/auth/passkeys/options', { method: 'POST' });
  let cred; try { cred = await navigator.credentials.create({ publicKey: creationOptions(options) }); } catch (e) { throw passkeyError(e); }
  return api('/api/auth/passkeys/verify', { method: 'POST', body: { response: credentialToJSON(cred), name } });
}
const deviceName = () => { const ua = navigator.userAgent; return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo'; };
async function deleteAccountWithPasskey(confirmEmail) {
  const options = await api('/api/account/delete/options', { method: 'POST' });
  let cred; try { cred = await navigator.credentials.get({ publicKey: requestOptions(options) }); } catch (e) { throw passkeyError(e); }
  return api('/api/account/delete', { method: 'POST', body: { response: credentialToJSON(cred), confirmEmail } });
}
async function refreshPasskeys() { try { state.pk = await api('/api/auth/passkeys'); } catch { state.pk = null; } }

async function boot() {
  try { const hl = await fetch('/api/health').then(r => r.json()); state.devLogin = !!hl.devLogin; state.mailDev = !!hl.mailDev; } catch { /* ignorar */ }
  state.verifyToken = verifyTokenFromHash(location.hash);
  if (state.verifyToken) history.replaceState(null, '', location.pathname + location.search);   // sacar el token de la barra de direcciones
  try { state.me = await api('/api/me'); await refreshPasskeys(); } catch { state.me = null; }
  render();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function render() {
  $app.replaceChildren();
  document.querySelector('.tabs')?.remove();
  if (state.verifyToken) return $app.append(verifyEmailView());
  if (!state.me) return $app.append(loginView());
  if (state.codes) return $app.append(codesView());
  $app.append(({ capture: captureView, memory: memoryView, ask: askView, sources: sourcesView, account: accountView })[state.tab]());
  document.body.append(h('div', { class: 'tabs' },
    ...[['capture', 'Capturar'], ['memory', 'Memoria'], ['ask', 'Preguntar'], ['sources', 'Fuentes'], ['account', 'Cuenta']].map(([k, label]) =>
      h('button', { class: state.tab === k ? 'on' : '', onclick: () => { state.tab = k; if (k !== 'ask') { state.items = null; state.sources = null; } render(); } }, label))));
}

// ---------------------------------------------------------------- verificación de email
// Confirmar es un POST desde esta pantalla (no un GET al abrir el enlace): así los antivirus de correo no gastan el token.
function verifyEmailView() {
  const box = h('div', { class: 'card' });
  const btn = h('button', { class: 'primary', onclick: async () => {
    btn.disabled = true;
    try {
      await api('/api/auth/email/verify', { method: 'POST', body: { token: state.verifyToken } });
      state.verifyToken = null;
      try { state.me = await api('/api/me'); } catch { /* sin sesión en este navegador: está bien */ }
      toast('¡Email verificado!'); render();
    } catch (e) {
      box.replaceChildren(h('strong', {}, 'No se pudo verificar'), h('p', {}, e.message), h('div', { class: 'row' }, h('button', { onclick: () => { state.verifyToken = null; render(); } }, 'Continuar')));
    }
  } }, 'Confirmar mi email');
  box.append(h('strong', {}, 'Confirmá tu email'), h('p', { class: 'muted' }, 'Tocá el botón para confirmar que este email es tuyo. Si no creaste una cuenta en MindSync, cerrá esta página: no pasa nada.'), h('div', { class: 'row' }, btn));
  return h('div', {}, h('h1', {}, 'MindSync'), box);
}

function verifyBanner() {
  if (!state.me?.user || state.me.user.emailVerified) return null;
  const resend = h('button', { onclick: async () => {
    resend.disabled = true;
    try { await api('/api/auth/email/resend', { method: 'POST' }); toast('Te enviamos un correo nuevo.'); } catch (e) { toast(e.message); }
    resend.disabled = false;
  } }, 'Reenviar correo');
  const row = h('div', { class: 'row' }, resend);
  if (state.mailDev) row.append(h('button', { onclick: async () => {
    try {
      const list = await api('/api/dev/outbox');
      sheet(h('h2', {}, 'Correo de desarrollo'), h('p', { class: 'muted' }, 'Este servidor no tiene SMTP configurado, así que NO se envió ningún correo real. Abrí el enlace para verificar:'),
        ...(list.length ? list.map(m => h('p', {}, h('a', { href: m.link }, m.link))) : [h('p', {}, 'Todavía no hay ningún correo para tu cuenta. Probá "Reenviar correo".')]));
    } catch (e) { toast(e.message); }
  } }, '📬 Ver correo de desarrollo'));
  return h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('strong', {}, 'Verificá tu email'),
    h('p', { class: 'muted' }, `Te enviamos un enlace a ${state.me.user.email}. Hasta que lo confirmes, tu email no se puede usar para invitar ni compartir.`), row);
}

// ---------------------------------------------------------------- acceso con passkeys
function loginView() {
  const email = h('input', { type: 'email', placeholder: 'tu@email.com', autocomplete: 'username webauthn' });
  const rEmail = h('input', { type: 'email', placeholder: 'tu@email.com' }), rCode = h('input', { type: 'text', placeholder: 'XXXX-XXXX-XXXX-XXXX', autocomplete: 'off' });
  const guard = fn => async ev => { const b = ev.currentTarget; b.disabled = true; try { await fn(); } catch (e) { toast(e.message); } b.disabled = false; };
  const enter = async () => { state.me = await api('/api/me'); await refreshPasskeys(); render(); };

  const login = h('button', { class: 'primary', onclick: guard(async () => { await loginWithPasskey(); await enter(); }) }, '🔑 Entrar con passkey');
  const create = h('button', { onclick: guard(async () => {
    if (!email.value.trim()) throw new Error('Escribí tu email para crear la cuenta.');
    const r = await registerWithPasskey(email.value.trim(), deviceName());
    state.codes = r.recoveryCodes; await enter();
  }) }, 'Crear cuenta con passkey');
  const recover = h('button', { onclick: guard(async () => {
    const r = await api('/api/auth/recovery', { method: 'POST', body: { email: rEmail.value.trim(), code: rCode.value.trim() } });
    state.mustAdd = !!r.mustAddPasskey; await enter();
  }) }, 'Entrar con código');

  const dev = h('button', { onclick: guard(async () => { await api('/api/dev-login', { method: 'POST', body: { email: email.value.trim() } }); await enter(); }) }, 'Entrar sin passkey (solo desarrollo)');
  return h('div', {}, h('h1', {}, 'MindSync'),
    h('p', { class: 'muted' }, 'Tu segunda mente. Entrás con una passkey: tu huella, tu rostro o el PIN de tu dispositivo. No hay contraseñas.'),
    hasPasskeys() ? null : h('div', { class: 'card' }, 'Este navegador no soporta passkeys. Probá con uno actualizado (Chrome, Safari o Edge recientes).'),
    h('div', { class: 'card' }, h('div', { class: 'row' }, login), h('div', { class: 'muted' }, 'El navegador te ofrece tus cuentas guardadas.')),
    h('div', { class: 'card' }, h('strong', {}, 'Cuenta nueva'), h('div', { style: 'height:6px' }), email, h('div', { class: 'row' }, create),
      h('div', { class: 'muted' }, 'Tu email identifica la cuenta; todavía no lo verificamos, así que no lo uses para recibir nada importante.')),
    h('details', { class: 'card' }, h('summary', {}, 'Perdí mi dispositivo'),
      h('p', { class: 'muted' }, 'Usá uno de los códigos de recuperación que te mostramos al crear la cuenta. Cada uno sirve una sola vez.'),
      rEmail, h('div', { style: 'height:6px' }), rCode, h('div', { class: 'row' }, recover)),
    state.devLogin ? h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Modo desarrollo (DEV_LOGIN=1):'), h('div', { class: 'row' }, dev)) : null);
}

// Los códigos se muestran UNA vez: en el servidor solo quedan sus hashes.
function codesView() {
  const text = state.codes.join('\n');
  const saved = h('input', { type: 'checkbox', id: 'saved' });
  const go = h('button', { class: 'primary', disabled: true, onclick: () => { state.codes = null; render(); } }, 'Continuar');
  saved.addEventListener('change', () => { go.disabled = !saved.checked; });
  return h('div', {}, h('h1', {}, 'Guardá tus códigos de recuperación'),
    h('p', { class: 'muted' }, 'Si perdés todos tus dispositivos, estos códigos son la única forma de volver a entrar a tu memoria. Cada uno sirve una sola vez y NO se vuelven a mostrar. Guardalos en un gestor de contraseñas o impresos, no en este mismo dispositivo.'),
    h('div', { class: 'card' }, h('pre', { style: 'font-family: ui-monospace, monospace; line-height: 1.9' }, text),
      h('div', { class: 'row' },
        h('button', { onclick: async () => { await navigator.clipboard?.writeText(text).catch(() => {}); toast('Copiados.'); } }, 'Copiar'),
        h('button', { onclick: () => { const a = h('a', { href: URL.createObjectURL(new Blob([`Códigos de recuperación de MindSync\n(cada uno sirve una sola vez)\n\n${text}\n`], { type: 'text/plain' })), download: 'mindsync-recuperacion.txt' }); a.click(); } }, 'Descargar .txt'))),
    h('div', { class: 'row' }, saved, h('label', { for: 'saved' }, 'Ya los guardé en un lugar seguro')), h('div', { class: 'row' }, go));
}

// ---------------------------------------------------------------- captura
function captureView() {
  const text = h('textarea', { placeholder: 'Escribí una idea, una nota o pegá la transcripción de una reunión…' });
  const isMeeting = h('input', { type: 'checkbox', id: 'meet' });
  const consent = h('input', { type: 'checkbox', id: 'consent' });
  const selfName = h('input', { type: 'text', placeholder: 'Cómo aparecés en la transcripción (ej: Ana o Hablante 1)' });
  const meetBox = h('div', { class: 'card', style: 'display:none' },
    h('div', { class: 'row' }, consent, h('label', { for: 'consent' }, 'Confirmo que todos los participantes aceptaron que se grabe/transcriba esta reunión.')),
    selfName, h('div', { class: 'muted', style: 'margin-top:6px' }, 'Sirve para distinguir lo que dijiste vos de lo que dijeron otros.'));
  isMeeting.addEventListener('change', () => { meetBox.style.display = isMeeting.checked ? '' : 'none'; });
  const status = h('div', { class: 'muted' });

  const meetingOpts = () => {
    if (!isMeeting.checked) return { kind: 'text' };
    if (!consent.checked) throw new Error(ERRORS.consent_required);
    return { kind: 'meeting', consentDeclared: true, selfSpeaker: selfName.value.trim() || undefined };
  };
  const busy = (on, msg = '') => { status.replaceChildren(on ? h('span', { class: 'spin' }) : '', msg); for (const b of $app.querySelectorAll('button')) b.disabled = on; };
  const done = r => {
    const msg = r.deduped ? 'Ya tenías guardado exactamente esto.' : `Listo: ${r.entities} elementos extraídos${r.droppedQuotes ? ` (${r.droppedQuotes} descartados por no tener cita verificable)` : ''}.`;
    toast(msg); text.value = ''; state.items = null; busy(false, msg);
  };

  const save = h('button', { class: 'primary', onclick: async () => {
    if (!text.value.trim()) return;
    try {
      const opts = meetingOpts();
      busy(true, ' Procesando… (puede tardar unos segundos)');
      done(await api('/api/capture', { method: 'POST', body: { text: text.value, ...opts } }));
    } catch (e) { busy(false); toast(e.message); }
  } }, 'Guardar');

  // --- voz (WAV 16 kHz mono grabado en el navegador: formato que acepta la transcripción)
  const recBtn = h('button', {}, '🎙 Grabar');
  const recTime = h('span', { class: 'rec' });
  let rec = null;
  recBtn.addEventListener('click', async () => {
    if (rec) { const wav = await rec.stop(); rec = null; recBtn.textContent = '🎙 Grabar'; recTime.textContent = ''; return sendAudio(wav, 'audio/wav'); }
    try { rec = await startRecording(s => { recTime.textContent = `● ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`; }); recBtn.textContent = '■ Detener y guardar'; }
    catch { toast('No pude acceder al micrófono. En el celular necesitás abrir la app por HTTPS.'); }
  });
  async function sendAudio(blob, mime) {
    try {
      const o = meetingOpts();
      busy(true, ' Transcribiendo… (una reunión larga puede tardar un par de minutos)');
      const qs = new URLSearchParams({ kind: o.kind === 'meeting' ? 'meeting' : 'voice', consent: o.consentDeclared ? '1' : '0', ingest: '0' });
      if (o.selfSpeaker) qs.set('selfSpeaker', o.selfSpeaker);
      const r = await api(`/api/capture/audio?${qs}`, { method: 'POST', raw: blob, headers: { 'content-type': mime } });
      busy(false);
      reviewTranscript(r.transcript, o, r.seconds);
    } catch (e) { busy(false); toast(e.message); }
  }
  // La transcripción la hace un modelo de IA y puede equivocarse o inventar texto: el usuario la revisa ANTES de guardar.
  function reviewTranscript(transcript, o, seconds) {
    const ta = h('textarea', { style: 'min-height:220px' }); ta.value = transcript;
    const box = h('div', { class: 'card' },
      h('strong', {}, 'Revisá la transcripción antes de guardar'),
      h('p', { class: 'muted' }, `Audio de ${seconds ? Math.round(seconds) + ' s' : 'duración desconocida'}. La IA puede equivocarse o inventar palabras: corregí lo que haga falta. Solo se guarda lo que quede acá.`),
      ta, h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: async () => {
          try {
            busy(true, ' Procesando…');
            done(await api('/api/capture', { method: 'POST', body: { text: ta.value, kind: o.kind === 'meeting' ? 'meeting' : 'voice', consentDeclared: o.consentDeclared, selfSpeaker: o.selfSpeaker, context: { via: 'audio', reviewed: true } } }));
            box.remove();
          } catch (e) { busy(false); toast(e.message); }
        } }, 'Guardar'),
        h('button', { onclick: () => box.remove() }, 'Descartar')));
    status.after(box);
  }
  const file = h('input', { type: 'file', accept: 'audio/*,text/plain,.txt,.md,.vtt,.srt', style: 'display:none', onchange: async ev => {
    const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
    if (f.type.startsWith('audio/')) return sendAudio(f, f.type);
    text.value = await f.text();
    toast('Archivo cargado en el cuadro de texto. Revisalo y tocá Guardar.');
  } });

  return h('div', {}, verifyBanner(), accountBanner(), h('h1', {}, 'Capturar'),
    h('p', { class: 'muted' }, 'Anotá una idea, grabá tu voz o subí una reunión. Se guarda tal cual y se extraen ideas, tareas y decisiones, cada una con su cita.'),
    h('div', { class: 'card' }, text,
      h('div', { class: 'row' }, isMeeting, h('label', { for: 'meet' }, 'Es una reunión con otras personas')), meetBox,
      h('div', { class: 'row' }, save, recBtn, recTime, h('button', { onclick: () => file.click() }, '📎 Subir audio/texto'), file), status),
    h('p', { class: 'muted' }, 'Tip: para reuniones largas, grabalas con tu celular (Notas de voz) y subí el archivo acá.'));
}

function accountBanner() {
  if (state.mustAdd) return h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('strong', {}, 'Entraste con un código de recuperación'),
    h('p', { class: 'muted' }, 'Agregá una passkey en este dispositivo ahora, y quitá la del dispositivo que perdiste.'),
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => { try { await addPasskey(deviceName()); state.mustAdd = false; await refreshPasskeys(); toast('Passkey agregada.'); render(); } catch (e) { toast(e.message); } } }, 'Agregar passkey')));
  if (state.pk && state.pk.passkeys.length === 1) return h('div', { class: 'card', style: 'border-color:var(--warn)' }, h('strong', {}, 'Tenés una sola passkey'),
    h('p', { class: 'muted' }, 'Si perdés ese dispositivo y no tenés los códigos, perdés el acceso a tu memoria. Agregá otro dispositivo.'),
    h('div', { class: 'row' }, h('button', { onclick: () => { state.tab = 'account'; render(); } }, 'Ir a mi cuenta')));
  return null;
}

// Grabación a WAV 16 kHz mono, submuestreando sobre la marcha para no acumular memoria.
async function startRecording(onTick) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const src = ctx.createMediaStreamSource(stream);
  const proc = ctx.createScriptProcessor(4096, 1, 1);
  const TARGET = 16000, ratio = ctx.sampleRate / TARGET, parts = [];
  let acc = 0, n = 0, pos = 0, total = 0;
  proc.onaudioprocess = e => {
    const input = e.inputBuffer.getChannelData(0), out = new Int16Array(Math.ceil(input.length / ratio) + 1);
    let o = 0;
    for (let i = 0; i < input.length; i++) {
      acc += input[i]; n++; pos++;
      if (pos >= ratio) { const v = Math.max(-1, Math.min(1, acc / n)); out[o++] = v < 0 ? v * 0x8000 : v * 0x7fff; acc = 0; n = 0; pos -= ratio; }
    }
    parts.push(out.subarray(0, o)); total += o; onTick(total / TARGET);
  };
  src.connect(proc); proc.connect(ctx.destination);
  return {
    async stop() {
      proc.disconnect(); src.disconnect(); stream.getTracks().forEach(t => t.stop()); await ctx.close();
      const buf = new ArrayBuffer(44 + total * 2), v = new DataView(buf);
      const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
      w(0, 'RIFF'); v.setUint32(4, 36 + total * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
      v.setUint32(24, TARGET, true); v.setUint32(28, TARGET * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, total * 2, true);
      let off = 44; for (const p of parts) { new Int16Array(buf, off, p.length).set(p); off += p.length * 2; }
      return new Blob([buf], { type: 'audio/wav' });
    },
  };
}

// ---------------------------------------------------------------- memoria
function memoryView() {
  const box = h('div', {});
  const filters = [['unreviewed', 'Sin revisar'], ['confirmed', 'Confirmadas'], ['all', 'Todas']];
  const bar = h('div', { class: 'row' }, ...filters.map(([k, l]) => h('button', { class: state.filter === k ? 'primary' : '', onclick: () => { state.filter = k; state.items = null; render(); } }, l)));
  const load = async () => {
    try {
      state.items = await api(`/api/items${state.filter === 'all' ? '' : `?state=${state.filter}`}`);
      box.replaceChildren(...(state.items.length ? state.items.map(itemCard) : [h('p', { class: 'muted' }, state.filter === 'unreviewed' ? 'No tenés nada pendiente de revisar. Capturá una nota para empezar.' : 'No hay nada acá todavía.')]));
    } catch (e) { box.replaceChildren(h('p', { class: 'muted' }, e.message)); }
  };
  load();
  return h('div', {}, h('h1', {}, 'Memoria'),
    h('p', { class: 'muted' }, 'Lo que MindSync extrajo de tus notas. Es una propuesta: confirmá, corregí o rechazá cada cosa.'), bar, box);
}

function itemCard(it) {
  const [stLabel, stCls] = STATE[it.validation_state];
  const actions = h('div', { class: 'row' });
  const review = async (action, extra = {}) => {
    try { await api(`/api/entities/${it.id}/review`, { method: 'POST', body: { action, ...extra } }); state.items = null; render(); }
    catch (e) { toast(e.message); }
  };
  if (it.validation_state === 'unreviewed' || it.validation_state === 'rejected')
    actions.append(h('button', { class: 'primary', onclick: () => review('confirm') }, '✓ Confirmar'));
  if (it.validation_state !== 'rejected') actions.append(h('button', { class: 'danger', onclick: () => review('reject') }, '✕ Rechazar'));
  actions.append(h('button', { onclick: () => editSheet(it, review) }, '✎ Editar'));
  if (it.source_id) actions.append(h('button', { onclick: () => sourceSheet(it.source_id, it.quote) }, 'Ver origen'));
  return h('div', { class: 'card' },
    h('div', {}, h('span', { class: 'badge' }, TYPE[it.type] ?? it.type), h('span', { class: `badge ${stCls}` }, stLabel),
      h('span', { class: 'muted' }, EPI[it.epistemic_status] ?? '')),
    h('div', { class: 'title' }, it.title), it.body ? h('div', {}, it.body) : null,
    it.quote ? h('div', { class: 'quote' }, `“${it.quote}”`) : null,
    h('div', { class: 'muted' }, [it.asserted_by ? `Lo dijo ${it.asserted_by} · ` : '', SOURCE[it.source_kind] ?? '', ' · ', fmtDate(it.captured_at ?? it.created_at)].join('')),
    actions);
}

function sheet(...content) {
  const el = h('div', { class: 'sheet', onclick: e => { if (e.target === el) el.remove(); } }, h('div', {}, ...content, h('div', { class: 'row' }, h('button', { onclick: () => el.remove() }, 'Cerrar'))));
  document.body.append(el); return el;
}

function editSheet(it, review) {
  const title = h('input', { type: 'text', value: it.title }), body = h('textarea', { style: 'min-height:90px' });
  body.value = it.body ?? '';
  const s = sheet(h('h2', {}, 'Editar'), title, h('div', { style: 'height:8px' }), body,
    h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => { await review('edit', { title: title.value, body: body.value || null }); s.remove(); } }, 'Guardar cambios')));
}

async function sourceSheet(id, quote) {
  const pre = h('pre', {}, 'Cargando…');
  sheet(h('h2', {}, 'Texto original'), h('p', { class: 'muted' }, 'La cita extraída aparece resaltada.'), pre);
  try {
    const r = await api(`/api/sources/${id}`);
    pre.replaceChildren(...highlight(r.text, quote));
  } catch (e) { pre.textContent = e.message; }
}
function highlight(text, quote) {
  if (!quote) return [text];
  const i = text.toLowerCase().indexOf(quote.toLowerCase().slice(0, 80));
  if (i < 0) return [text];
  const len = quote.toLowerCase().length <= 80 ? quote.length : 80;
  return [text.slice(0, i), h('mark', {}, text.slice(i, i + len)), text.slice(i + len)];
}

// ---------------------------------------------------------------- preguntar
function askView() {
  const log = h('div', {});
  const draw = () => log.replaceChildren(...state.chat.map(m => m.role === 'user'
    ? h('div', { class: 'msg-user' }, h('div', { class: 'card' }, m.text))
    : h('div', { class: 'card' }, answerNodes(m), m.insufficient ? h('div', { class: 'muted' }, 'No encontré información suficiente en tu memoria.') : null,
        m.sources?.length ? h('div', { class: 'muted', style: 'margin-top:8px' }, 'Fuentes: ', ...m.sources.map(s => h('button', { class: 'cite', onclick: () => sourceSheet(s.sourceId, s.text.slice(0, 80)) }, `[${s.n}] ${SOURCE[s.kind] ?? s.kind} ${fmtDate(s.capturedAt)}`), ' ')) : null)));
  function answerNodes(m) {
    return m.text.split(/(\[\d+\])/).map(part => {
      const mt = /^\[(\d+)\]$/.exec(part); const s = mt && m.sources.find(x => x.n === Number(mt[1]));
      return s ? h('button', { class: 'cite', onclick: () => sourceSheet(s.sourceId, s.text.slice(0, 80)) }, part) : part;
    });
  }
  const q = h('input', { type: 'text', placeholder: 'Preguntale a tu memoria… (ej: ¿qué decidimos sobre el deploy?)' });
  const send = h('button', { class: 'primary', onclick: async () => {
    const question = q.value.trim(); if (!question) return;
    q.value = ''; state.chat.push({ role: 'user', text: question }); draw(); send.disabled = true;
    const pending = h('div', { class: 'muted' }, h('span', { class: 'spin' }), 'Buscando en tu memoria…'); log.append(pending);
    try { const r = await api('/api/chat', { method: 'POST', body: { question } }); state.chat.push({ role: 'ai', text: r.answer, sources: r.sources, insufficient: r.insufficient }); }
    catch (e) { state.chat.push({ role: 'ai', text: e.message, sources: [] }); }
    send.disabled = false; draw();
  } }, 'Preguntar');
  q.addEventListener('keydown', e => { if (e.key === 'Enter') send.click(); });
  draw();
  return h('div', {}, h('h1', {}, 'Preguntar'), h('p', { class: 'muted' }, 'Responde solo con lo que guardaste y cita sus fuentes. Si no alcanza, te lo dice.'), log, h('div', { class: 'row' }, q, send));
}

// ---------------------------------------------------------------- fuentes y ajustes
function sourcesView() {
  const box = h('div', {});
  (async () => {
    try {
      const list = await api('/api/sources');
      box.replaceChildren(...(list.length ? list.map(s => h('div', { class: 'card' },
        h('div', {}, h('span', { class: 'badge' }, SOURCE[s.kind] ?? s.kind), s.ingestion_status !== 'done' ? h('span', { class: 'badge bad' }, s.ingestion_status === 'failed' ? 'falló' : s.ingestion_status) : null, h('span', { class: 'muted' }, `${fmtDate(s.captured_at)} · ${s.derived} extraídos`)),
        h('div', {}, s.preview), h('div', { class: 'row' },
          h('button', { onclick: () => sourceSheet(s.id) }, 'Ver'),
          h('button', { class: 'danger', onclick: async () => {
            if (!confirm('¿Borrar esta fuente y todo lo que se extrajo de ella? No se puede deshacer.')) return;
            try { await api(`/api/sources/${s.id}`, { method: 'DELETE' }); toast('Borrado.'); render(); } catch (e) { toast(e.message); }
          } }, 'Borrar')))) : [h('p', { class: 'muted' }, 'Todavía no guardaste nada.')]));
    } catch (e) { box.replaceChildren(h('p', { class: 'muted' }, e.message)); }
  })();
  return h('div', {}, h('h1', {}, 'Fuentes'), h('p', { class: 'muted' }, 'Todo lo que capturaste, tal cual. Podés borrar cualquiera de ellas.'), box);
}

// Pestaña propia: dispositivos (passkeys), códigos de recuperación, exportar, salir y borrar la cuenta.
function accountView() {
  return h('div', {}, verifyBanner(), h('h1', {}, 'Cuenta'), h('p', { class: 'muted' }, 'Tus dispositivos de acceso, tus datos y la zona de peligro.'), accountCard());
}

function accountCard() {
  const box = h('div', { class: 'card' }, h('div', {}, state.me.user.email, ' ', h('span', { class: `badge ${state.me.user.emailVerified ? 'ok' : 'warn'}` }, state.me.user.emailVerified ? 'verificado ✓' : 'sin verificar')));
  const list = h('div', {});
  const redraw = async () => {
    await refreshPasskeys();
    const pk = state.pk; if (!pk) return;
    list.replaceChildren(h('div', { class: 'muted', style: 'margin-top:8px' }, `Passkeys (${pk.passkeys.length}) · códigos de recuperación sin usar: ${pk.recoveryCodesLeft}`),
      ...pk.passkeys.map(p => h('div', { class: 'row', style: 'justify-content:space-between' },
        h('div', {}, h('strong', {}, p.name), h('div', { class: 'muted' }, `${p.backed_up ? 'sincronizada' : 'solo este dispositivo'} · creada ${fmtDate(p.created_at)}${p.last_used_at ? ` · último uso ${fmtDate(p.last_used_at)}` : ''}`)),
        h('div', { class: 'row' },
          h('button', { onclick: () => renameSheet(p, redraw) }, 'Renombrar'),
          h('button', { class: 'danger', onclick: async () => {
            if (!confirm(`¿Quitar "${p.name}"? Ese dispositivo ya no podrá entrar.`)) return;
            try { await api(`/api/auth/passkeys/${p.id}`, { method: 'DELETE' }); toast('Passkey quitada.'); await redraw(); } catch (e) { toast(e.message); }
          } }, 'Quitar')))));
  };
  redraw();
  box.append(list, h('div', { class: 'row' },
    h('button', { onclick: async () => { try { await addPasskey(deviceName()); toast('Passkey agregada.'); await redraw(); } catch (e) { toast(e.message); } } }, '＋ Agregar otro dispositivo'),
    h('button', { onclick: async () => {
      if (!confirm('Se generan 8 códigos nuevos y los anteriores dejan de servir. ¿Seguir?')) return;
      try { state.codes = (await api('/api/auth/recovery-codes', { method: 'POST' })).recoveryCodes; render(); } catch (e) { toast(e.message); }
    } }, 'Generar nuevos códigos')),
    h('div', { class: 'row' }, h('a', { href: '/api/export', download: 'mindsync-export.json' }, h('button', {}, '⬇ Exportar toda mi memoria')),
      h('button', { onclick: async () => { await api('/api/logout', { method: 'POST' }); state.me = null; state.chat = []; state.pk = null; render(); } }, 'Salir')),
    h('div', { style: 'border-top:1px solid var(--line); margin-top:12px; padding-top:10px' },
      h('div', { class: 'muted' }, 'Zona de peligro'),
      h('div', { class: 'row' }, h('button', { class: 'danger', onclick: deleteAccountSheet }, 'Borrar mi cuenta y todo mi contenido…'))));
  return box;
}

async function deleteAccountSheet() {
  let sum; try { sum = await api('/api/account/summary'); } catch (e) { return toast(e.message); }
  const email = h('input', { type: 'text', placeholder: sum.email, autocomplete: 'off', spellcheck: 'false' });
  const go = h('button', { class: 'danger', disabled: true, onclick: async () => {
    go.disabled = true;
    try {
      await deleteAccountWithPasskey(email.value.trim());
      s.remove(); state.me = null; state.chat = []; state.pk = null; state.tab = 'capture'; render();
      toast('Tu cuenta y todo tu contenido fueron borrados.');
    } catch (e) { toast(e.message); go.disabled = email.value.trim().toLowerCase() !== sum.email; }
  } }, 'Borrar para siempre');
  email.addEventListener('input', () => { go.disabled = email.value.trim().toLowerCase() !== sum.email; });
  const s = sheet(h('h2', {}, 'Borrar mi cuenta'),
    h('p', {}, 'Esto es ', h('strong', {}, 'definitivo y no se puede deshacer'), '. Se borra ahora mismo:'),
    h('ul', {}, h('li', {}, `${sum.sources} fuentes (notas, voz, reuniones) con su texto original`), h('li', {}, `${sum.entities} elementos extraídos, sus relaciones y su historial`),
      h('li', {}, 'tus embeddings, el registro de uso de IA y el de auditoría'), h('li', {}, `tus ${sum.passkeys} passkeys y tus códigos de recuperación`)),
    h('p', { class: 'muted' }, 'Lo que NO podemos borrar: los archivos que ya exportaste, ni los textos que se enviaron a los proveedores de IA para procesarse (se rigen por sus propias políticas de retención). Las copias de seguridad, si existen, se eliminan al vencer su plazo.'),
    h('div', { class: 'row' }, h('a', { href: '/api/export', download: 'mindsync-export.json' }, h('button', {}, '⬇ Exportar antes de borrar'))),
    h('p', {}, 'Para confirmar, escribí tu email y después tu passkey. Cuando el navegador te lo pida, elegí la passkey de ', h('strong', {}, sum.email), ' (si tenés varias cuentas, la de otra no sirve):'), email,
    h('div', { class: 'row' }, go));
}

function renameSheet(p, done) {
  const name = h('input', { type: 'text', value: p.name, maxlength: '60' });
  const s = sheet(h('h2', {}, 'Renombrar passkey'), name, h('div', { class: 'row' }, h('button', { class: 'primary', onclick: async () => {
    try { await api(`/api/auth/passkeys/${p.id}`, { method: 'PATCH', body: { name: name.value.trim() } }); s.remove(); await done(); } catch (e) { toast(e.message); }
  } }, 'Guardar')));
}

boot();
