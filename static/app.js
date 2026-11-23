/* Vecino – interface web (résident, portería, administration). Vanilla JS, sans dépendances. */
"use strict";

// ---------------------------------------------------------------- utilitaires
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const S = { me: null, res: null, tab: null, seg: {}, es: null, live: false, alerts: [], timers: [], audio: null, chatWait: new Set() };

// Adresse du serveur : vide = même serveur ; sinon définie dans config.js (page sur GitHub Pages + tunnel)
const BASE = window.VECINO_API ? String(window.VECINO_API).replace(/\/?$/, "/") : "";
const TOKEN_KEY = "vecino_token";
const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ""; } catch { return ""; } };
const setToken = t => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { } };
const tokenQ = () => (BASE && getToken() ? "?token=" + encodeURIComponent(getToken()) : "");

class ApiError extends Error { constructor(msg, status) { super(msg); this.status = status; } }

async function api(path, { method = "GET", body, form } = {}) {
  const opt = { method, headers: { "X-Vecino": "1" }, credentials: BASE ? "omit" : "same-origin" };
  if (getToken()) opt.headers["Authorization"] = "Bearer " + getToken();
  if (form) opt.body = form;
  else if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(BASE + "api/" + path, opt); }
  catch { throw new ApiError("Sin conexión. Verifique su internet.", 0); }
  let data = null;
  try { data = await r.json(); } catch { /* vide */ }
  if (!r.ok) {
    if (r.status === 401 && path !== "login" && path !== "me") { setToken(""); showLogin(); }
    let d = data && data.detail;
    if (Array.isArray(d)) d = "Datos incompletos o no válidos";
    throw new ApiError(d || `Error ${r.status}`, r.status);
  }
  return data;
}

function toast(msg, err = false, ms = 3500) {
  const t = $("#toast");
  t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(t._t); t._t = setTimeout(() => (t.hidden = true), ms);
}
const fail = e => toast(e.message || String(e), true);

function modal(html) { $("#modal-body").innerHTML = html; $("#modal").hidden = false; const f = $("#modal-body input,#modal-body textarea,#modal-body select"); if (f && !("noFocus" in (f.dataset))) setTimeout(() => f.focus(), 50); }
function closeModal() { $("#modal").hidden = true; $("#modal-body").innerHTML = ""; if (S.scanStop) S.scanStop(); }
$("#modal").addEventListener("click", e => { if (e.target.id === "modal") closeModal(); });

const tz = () => (S.res && S.res.timezone) || "America/Panama";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: tz() }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function fmtDT(iso, opts = { dateStyle: "short", timeStyle: "short" }) { if (!iso) return ""; return new Date(iso).toLocaleString("es-PA", { timeZone: tz(), ...opts }); }
const fmtT = iso => fmtDT(iso, { hour: "2-digit", minute: "2-digit" });
function fmtD(d) { if (!d) return ""; const x = new Date(d + "T12:00:00Z"); const s = x.toLocaleDateString("es-PA", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }); return d === today() ? "Hoy" : d === addDays(today(), 1) ? "Mañana" : s; }
function ago(iso) { const m = Math.round((Date.now() - new Date(iso)) / 60000); if (m < 1) return "ahora"; if (m < 60) return `hace ${m} min`; const h = Math.round(m / 60); if (h < 24) return `hace ${h} h`; return fmtDT(iso); }
const toMin = s => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const formData = f => Object.fromEntries(new FormData(f).entries());
const KIND = { visita: "Visita", servicio: "Servicio", delivery: "Delivery" };
const ROLE = { resident: "Residente", guard: "Portería", admin: "Administración", superadmin: "Super admin" };
const pill = (txt, cls = "") => `<span class="pill ${cls}">${esc(txt)}</span>`;
const VSTAT = { esperada: ["Esperada", "blu"], dentro: ["Dentro", ""], salio: ["Salió", "gray"], cancelada: ["Cancelada", "gray"] };
const RSTAT = { confirmada: ["Confirmada", ""], pendiente: ["Pendiente", "amb"], cancelada: ["Cancelada", "gray"], rechazada: ["Rechazada", "red"] };
const QSTAT = { pendiente: ["Esperando respuesta", "amb"], autorizada: ["Autorizada", ""], rechazada: ["Rechazada", "red"], expirada: ["Sin respuesta", "gray"] };
const TSTAT = { abierto: ["Abierta", "amb"], en_proceso: ["En proceso", "blu"], resuelto: ["Resuelta", ""], cerrado: ["Cerrada", "gray"] };
const CATS = { mantenimiento: "Mantenimiento", seguridad: "Seguridad", ruido: "Ruido", limpieza: "Limpieza", areas_comunes: "Áreas comunes", administracion: "Administración", otro: "Otro" };
const st = (map, k) => pill(...(map[k] || [k, "gray"]));
const empty = t => `<div class="empty">${esc(t)}</div>`;

// délégation d'événements : data-act="nom" (clic) et data-form="nom" (formulaire)
const ACT = {}, FORM = {};
document.addEventListener("click", e => {
  unlockAudio();
  const el = e.target.closest("[data-act]");
  if (!el) return;
  e.preventDefault();
  const fn = ACT[el.dataset.act];
  if (fn) Promise.resolve(fn(el, e)).catch(fail);
});
document.addEventListener("submit", e => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const fn = FORM[f.dataset.form];
  const btn = $("button[type=submit],button:not([type])", f);
  if (btn) btn.disabled = true;
  Promise.resolve(fn && fn(f, formData(f))).catch(fail).finally(() => { if (btn && btn.isConnected) btn.disabled = false; });
});
ACT.close = closeModal;

// ---------------------------------------------------------------- son (alertes)
function unlockAudio() {
  if (S.audio) return;
  try { S.audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { S.audio = null; }
}
function beep(times = 3) {
  if (!S.audio) return;
  const ctx = S.audio; if (ctx.state === "suspended") ctx.resume();
  for (let i = 0; i < times; i++) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "square"; o.frequency.value = i % 2 ? 660 : 990;
    g.gain.value = 0.25; o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime + i * 0.35; o.start(t); o.stop(t + 0.25);
  }
}
const vibrate = p => { try { navigator.vibrate && navigator.vibrate(p); } catch { } };

// ---------------------------------------------------------------- démarrage / connexion
async function boot() {
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => { });
  try {
    const d = await api("me");
    S.me = d.user; S.res = d.residence; S.appName = d.app_name;
    if (S.me.must_change_password) return showChangePassword(true);
    startApp();
  } catch (e) { if (e.status === 401) showLogin(); else $("#app").innerHTML = `<div class="splash">${esc(e.message)}<br><button class="btn mt" onclick="location.reload()">Reintentar</button></div>`; }
}

function stopAll() {
  S.timers.forEach(clearInterval); S.timers = [];
  if (S.es) { S.es.close(); S.es = null; }
  $("#alarm").hidden = true;
}

function showLogin() {
  stopAll(); S.me = null;
  $("#app").innerHTML = `<div class="login">
    <img class="logo" src="static/icon.svg" alt="">
    <h1>Vecino</h1><p class="mu">Acceso, reservas y seguridad de su residencia</p>
    <form data-form="login" class="card">
      <label>Correo electrónico</label><input name="email" type="email" autocomplete="username" required>
      <label>Contraseña</label><input name="password" type="password" autocomplete="current-password" required>
      <button class="btn block mt">Entrar</button>
    </form>
    <p class="mu sm">¿Olvidó su contraseña? Pídale a la administración que la restablezca.</p></div>`;
}
FORM.login = async (f, d) => {
  const r = await api("login", { method: "POST", body: d });
  setToken(r.token); S.me = r.user;
  let m;
  try { m = await api("me"); }
  catch (e) { if (e.status === 401) throw new Error("El navegador rechazó la sesión (cookie). Si usa http://, active https o ponga COOKIE_SECURE=false."); throw e; } S.res = m.residence; S.appName = m.app_name;
  if (S.me.must_change_password) return showChangePassword(true, d.password);
  startApp();
};

function showChangePassword(first, current = "") {
  stopAll();
  $("#app").innerHTML = `<div class="login"><img class="logo" src="static/icon.svg" alt="">
    <h1>${first ? "Bienvenido/a" : "Cambiar contraseña"}</h1>
    <p class="mu">${first ? "Por seguridad, elija su propia contraseña." : ""}</p>
    <form data-form="pwfirst" class="card">
      <label>Contraseña actual${first ? " (la temporal)" : ""}</label><input name="current" type="password" value="${esc(current)}" required>
      <label>Nueva contraseña (mín. 8 caracteres)</label><input name="new" type="password" minlength="8" autocomplete="new-password" required>
      <label>Repetir nueva contraseña</label><input name="new2" type="password" minlength="8" required>
      <button class="btn block mt">Guardar</button>
    </form></div>`;
}
FORM.pwfirst = async (f, d) => {
  if (d.new !== d.new2) throw new Error("Las contraseñas no coinciden");
  const r = await api("me/password", { method: "POST", body: { current: d.current, new: d.new } });
  if (r.token) setToken(r.token);
  S.me.must_change_password = false; toast("Contraseña actualizada"); startApp();
};

// ---------------------------------------------------------------- structure
const TABS = {
  resident: [["inicio", "🏠", "Inicio"], ["visitas", "🎟️", "Visitas"], ["reservas", "📅", "Reservas"], ["asistente", "💬", "Asistente"], ["mas", "☰", "Más"]],
  guard: [["porteria", "🛡️", "Portería"], ["registro", "📋", "Registro"], ["alertas", "🚨", "Alertas"], ["asistente", "💬", "Reglamento"], ["mas", "☰", "Más"]],
  admin: [["panel", "📊", "Panel"], ["gente", "👥", "Residentes"], ["areas", "🏊", "Áreas"], ["comunidad", "📢", "Comunidad"], ["mas", "☰", "Más"]],
  superadmin: [["residencias", "🏢", "Residencias"], ["mas", "☰", "Más"]],
};

function startApp() {
  stopAll();
  const tabs = TABS[S.me.role];
  if (!S.tab || !tabs.find(t => t[0] === S.tab)) S.tab = (location.hash.slice(1) && tabs.find(t => t[0] === location.hash.slice(1))) ? location.hash.slice(1) : tabs[0][0];
  $("#app").innerHTML = `
    <header class="top"><div class="grow"><h1>${esc(S.res ? S.res.name : S.appName || "Vecino")}<small>${esc(S.me.name)} · ${esc(S.me.unit || ROLE[S.me.role])}</small></h1></div>
      <span class="dot off" id="live" title="Tiempo real"></span></header>
    <main id="main"></main>
    <nav class="tabs">${tabs.map(([k, ic, l]) => `<button data-act="tab" data-tab="${k}" class="${k === S.tab ? "on" : ""}"><span class="ic">${ic}</span>${l}<span class="badge" id="b-${k}" hidden></span></button>`).join("")}</nav>`;
  if (S.me.residence_id) connectStream();
  if (S.me.role === "guard" || S.me.role === "admin") { pollAlerts(); S.timers.push(setInterval(pollAlerts, 5000)); }
  if (S.me.role === "resident") { pollRequests(); S.timers.push(setInterval(pollRequests, 15000)); }
  show(S.tab);
}
ACT.tab = el => show(el.dataset.tab);

async function show(tab) {
  S.tab = tab; history.replaceState(null, "", "#" + tab);
  $$("nav.tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  const main = $("#main"); if (!main) return;
  const fn = VIEW[tab];
  try { main.innerHTML = await fn(); if (POST[tab]) POST[tab](); }
  catch (e) { main.innerHTML = empty(e.message); }
  window.scrollTo(0, 0);
}
const refresh = tab => { if (S.tab === tab && $("#modal").hidden) show(tab); };
const VIEW = {}, POST = {};
const seg = (key, items) => `<div class="seg">${items.map(([k, l]) => `<button data-act="seg" data-key="${key}" data-val="${k}" class="${(S.seg[key] || items[0][0]) === k ? "on" : ""}">${l}</button>`).join("")}</div>`;
const segv = (key, def) => S.seg[key] || def;
ACT.seg = el => { S.seg[el.dataset.key] = el.dataset.val; show(S.tab); };
function badge(tab, n) { const b = $("#b-" + tab); if (b) { b.hidden = !n; b.textContent = n; } }

// ---------------------------------------------------------------- temps réel
function connectStream() {
  if (!window.EventSource) return;
  const es = new EventSource(BASE + "api/stream" + tokenQ()); S.es = es;
  const live = on => { S.live = on; const d = $("#live"); if (d) d.classList.toggle("off", !on); };
  es.onopen = () => live(true);
  es.onerror = () => live(false);
  const on = (ev, fn) => es.addEventListener(ev, m => { try { fn(JSON.parse(m.data)); } catch (e) { console.error(e); } });
  on("panic", () => pollAlerts());
  on("panic_update", a => {
    if (S.me.role === "resident") { toast(a.resolved_at ? "Su alerta fue marcada como resuelta" : "La portería recibió su alerta y está atendiendo", false, 6000); refresh("inicio"); }
    else pollAlerts();
  });
  on("access_request", r => { pollRequests(); vibrate([300, 100, 300]); beep(2); });
  on("visitor_arrived", v => { toast(`🚪 ${v.visitor_name} acaba de ingresar`, false, 6000); refresh("visitas"); });
  on("request_answered", r => { toast(`${r.unit}: ${r.visitor_name} → ${QSTAT[r.status][0]}`, r.status !== "autorizada", 6000); beep(1); refresh("porteria"); });
  on("visits", () => refresh("porteria"));
  on("reservations", () => { refresh("areas"); refresh("panel"); });
  on("reservation_decided", r => { toast(`Reserva de ${r.space} ${r.status === "confirmada" ? "aprobada ✅" : "rechazada"}`, r.status !== "confirmada", 6000); refresh("reservas"); });
  on("announcement", a => { toast("📢 Nuevo anuncio: " + a.title, false, 6000); refresh("inicio"); });
  on("ticket", () => { refresh("comunidad"); refresh("mas"); refresh("panel"); });
  on("bot_answer", m => updateChat(m));
}

// ---------------------------------------------------------------- RÉSIDENT
VIEW.inicio = async () => {
  const [anns, alerts] = await Promise.all([api("announcements"), api("panic/mine")]);
  const open = alerts.find(a => !a.resolved_at);
  return `
    <div id="reqbox"></div>
    <div class="card center">
      <h3>Botón de pánico</h3>
      <div class="panic-wrap">
        <button class="panic" id="panic" aria-label="Mantener presionado para enviar alerta"><svg viewBox="0 0 186 186"><circle cx="93" cy="93" r="90"/></svg>SOS<small>mantener 2 s</small></button>
      </div>
      ${open ? `<div class="notice">${open.acknowledged_at ? "✅ La portería está atendiendo su alerta." : "⏳ Alerta enviada " + ago(open.created_at) + ". Esperando a la portería…"}</div>` : ""}
      <p class="mu sm">Avisa de inmediato a la portería y a la administración. <b>No reemplaza al 911</b>: en una emergencia grave llame también.</p>
      <a class="btn redl sm" href="tel:911">📞 Llamar al 911</a>
    </div>
    <h2>Anuncios</h2>
    ${anns.length ? anns.map(a => `<div class="card">${a.pinned ? pill("📌 Fijado", "amb") + " " : ""}<h3 style="display:inline">${esc(a.title)}</h3>
      <div class="mu sm">${fmtDT(a.created_at, { dateStyle: "medium" })}</div><div style="white-space:pre-wrap;margin-top:6px">${esc(a.body)}</div></div>`).join("") : empty("Sin anuncios por ahora")}`;
};
POST.inicio = () => { setupPanic(); renderRequests(); };

function setupPanic() {
  const b = $("#panic"); if (!b) return;
  let t = null;
  const start = e => { e.preventDefault(); unlockAudio(); b.classList.add("hold"); vibrate(40); t = setTimeout(firePanic, 2000); };
  const stop = () => { b.classList.remove("hold"); clearTimeout(t); };
  b.addEventListener("pointerdown", start);
  ["pointerup", "pointerleave", "pointercancel"].forEach(ev => b.addEventListener(ev, stop));
  b.addEventListener("contextmenu", e => e.preventDefault());
}
async function firePanic() {
  $("#panic").classList.remove("hold"); vibrate([200, 100, 200]);
  try {
    const a = await api("panic", { method: "POST", body: { message: "" } });
    modal(`<h2>🚨 Alerta enviada</h2><p>La portería y la administración fueron avisadas. Manténgase en un lugar seguro.</p>
      <form data-form="panicmsg" data-id="${a.id}"><label>¿Quiere agregar un detalle? (opcional)</label><input name="message" placeholder="Ej.: intruso en el estacionamiento"><div class="btns"><button class="btn red">Enviar detalle</button><a class="btn redl" href="tel:911">Llamar al 911</a><button type="button" class="btn sec" data-act="close">Cerrar</button></div></form>`);
    refresh("inicio");
  } catch (e) { modal(`<h2>No se pudo enviar la alerta</h2><p>${esc(e.message)}</p><p><b>Llame directamente a la portería o al 911.</b></p><div class="btns"><a class="btn red" href="tel:911">Llamar al 911</a><button class="btn sec" data-act="close">Cerrar</button></div>`); }
}
FORM.panicmsg = async (f, d) => { if (d.message.trim()) await api(`panic/${f.dataset.id}/message`, { method: "POST", body: d }); closeModal(); toast("Detalle enviado a la portería"); };

async function pollRequests() {
  if (S.me.role !== "resident") return;
  try { S.requests = await api("requests"); } catch { return; }
  const pend = S.requests.filter(r => r.status === "pendiente");
  badge("inicio", pend.length); renderRequests();
  if (pend.length && $("#modal").hidden && !S.reqShown?.has(pend[0].id)) {
    S.reqShown = S.reqShown || new Set(); S.reqShown.add(pend[0].id);
    const r = pend[0];
    modal(`<h2>🔔 Visitante en portería</h2><p><b>${esc(r.visitor_name)}</b> (${KIND[r.kind]}) pide ingresar a ${esc(r.unit)}.</p>${r.note ? `<p class="mu">${esc(r.note)}</p>` : ""}
      <div class="btns"><button class="btn" data-act="reqyes" data-id="${r.id}">✅ Autorizar</button><button class="btn redl" data-act="reqno" data-id="${r.id}">✖ Rechazar</button></div>`);
  }
}
function renderRequests() {
  const box = $("#reqbox"); if (!box || !S.requests) return;
  const pend = S.requests.filter(r => r.status === "pendiente");
  box.innerHTML = pend.map(r => `<div class="card" style="border-color:#f2c879;background:var(--ambl)"><b>🔔 ${esc(r.visitor_name)}</b> está en portería (${KIND[r.kind]}) · ${ago(r.created_at)}
    ${r.note ? `<div class="mu sm">${esc(r.note)}</div>` : ""}<div class="btns"><button class="btn sm" data-act="reqyes" data-id="${r.id}">Autorizar</button><button class="btn redl sm" data-act="reqno" data-id="${r.id}">Rechazar</button></div></div>`).join("");
}
async function answerReq(id, approve) { await api(`requests/${id}/respond`, { method: "POST", body: { approve } }); closeModal(); toast(approve ? "Autorizado ✅ La portería fue avisada" : "Rechazado"); await pollRequests(); refresh("visitas"); }
ACT.reqyes = el => answerReq(el.dataset.id, true);
ACT.reqno = el => answerReq(el.dataset.id, false);

// --- visitas
VIEW.visitas = async () => {
  const vs = await api("visits");
  const t = today();
  const upcoming = vs.filter(v => v.date >= t && v.status !== "cancelada" && v.status !== "salio");
  const past = vs.filter(v => !upcoming.includes(v));
  const card = v => `<div class="card"><div class="row"><div class="grow"><b>${esc(v.visitor_name)}</b> ${st(VSTAT, v.status)}<div class="mu sm">${KIND[v.kind]} · ${fmtD(v.date)}${v.time_from ? " · " + v.time_from + (v.time_to ? "–" + v.time_to : "") : ""}${v.plate ? " · 🚗 " + esc(v.plate) : ""}</div>
      ${v.entered_at ? `<div class="mu sm">Entró ${fmtT(v.entered_at)}${v.exited_at ? " · salió " + fmtT(v.exited_at) : ""}</div>` : ""}</div>
      ${v.status === "esperada" ? `<div class="code">${esc(v.code)}</div>` : ""}</div>
      ${v.status === "esperada" ? `<div class="btns"><button class="btn sm sec" data-act="qr" data-id="${v.id}" data-code="${v.code}" data-name="${esc(v.visitor_name)}" data-date="${v.date}">Ver QR</button><button class="btn sm sec" data-act="share" data-code="${v.code}" data-date="${v.date}" data-name="${esc(v.visitor_name)}">Compartir</button><button class="btn sm ghost" data-act="cancelvisit" data-id="${v.id}">Cancelar</button></div>` : ""}</div>`;
  return `<button class="btn block" data-act="newvisit">＋ Registrar visita</button>
    <p class="mu sm">Registre a sus visitas, deliveries o servicios. Recibirán un código que la portería verifica al llegar.</p>
    <h2>Próximas</h2>${upcoming.length ? upcoming.map(card).join("") : empty("No hay visitas registradas")}
    ${past.length ? `<h2>Recientes</h2>${past.map(card).join("")}` : ""}`;
};
ACT.newvisit = () => modal(`<h2>Registrar visita</h2><form data-form="visit">
  <label>Nombre del visitante o empresa</label><input name="visitor_name" required maxlength="160">
  <label>Tipo</label><select name="kind"><option value="visita">Visita</option><option value="delivery">Delivery</option><option value="servicio">Servicio (técnico, limpieza…)</option></select>
  <label>Fecha</label><input name="date" type="date" value="${today()}" min="${today()}" required>
  <div class="grid2"><div><label>Desde (opcional)</label><input name="time_from" type="time"></div><div><label>Hasta (opcional)</label><input name="time_to" type="time"></div></div>
  <div class="grid2"><div><label>Placa (opcional)</label><input name="plate" maxlength="20"></div><div><label>Cédula (opcional)</label><input name="doc_id" maxlength="60"></div></div>
  <label>Nota para la portería (opcional)</label><input name="notes" maxlength="300">
  <div class="btns"><button class="btn">Crear código</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
FORM.visit = async (f, d) => {
  const v = await api("visits", { method: "POST", body: d });
  qrModal(v.id, v.code, v.visitor_name, v.date); refresh("visitas");
};
function qrModal(id, code, name, date) {
  modal(`<h2>Código para ${esc(name)}</h2><p class="mu">${fmtD(date)} · muéstrelo en portería</p>
    <img class="qr" src="${BASE}api/visits/${id}/qr.svg${tokenQ()}" alt="QR"><div class="center code">${esc(code)}</div>
    <div class="btns"><button class="btn" data-act="share" data-code="${code}" data-date="${date}" data-name="${esc(name)}">Compartir por WhatsApp</button><button class="btn sec" data-act="close">Listo</button></div>`);
}
ACT.qr = el => qrModal(el.dataset.id, el.dataset.code, el.dataset.name, el.dataset.date);
ACT.share = async el => {
  const txt = `Hola ${el.dataset.name}, tu código de acceso a ${S.res.name} (${S.me.unit || ""}) para ${fmtD(el.dataset.date).toLowerCase()} es: ${el.dataset.code}\nMuéstralo en la portería al llegar.`;
  if (navigator.share) { try { await navigator.share({ text: txt }); return; } catch { return; } }
  window.open("https://wa.me/?text=" + encodeURIComponent(txt), "_blank");
};
ACT.cancelvisit = async el => { if (!confirm("¿Cancelar esta visita?")) return; await api("visits/" + el.dataset.id, { method: "DELETE" }); toast("Visita cancelada"); refresh("visitas"); };

// --- réservations
VIEW.reservas = async () => {
  const [spaces, mine] = await Promise.all([api("spaces"), api("reservations")]);
  S.spaces = spaces;
  const act = mine.filter(r => r.status === "confirmada" || r.status === "pendiente");
  const other = mine.filter(r => !act.includes(r));
  return `<h2>Áreas comunes</h2>
    ${spaces.length ? spaces.map(s => `<div class="card list"><div class="grow"><b>${esc(s.name)}</b><div class="mu sm">${s.open_time}–${s.close_time} · máx. ${s.max_hours} h · ${s.exclusive ? "uso exclusivo" : "cupo " + s.capacity + " pers."}${s.requires_approval ? " · requiere aprobación" : ""}</div>${s.description ? `<div class="sm">${esc(s.description)}</div>` : ""}</div><button class="btn sm" data-act="book" data-id="${s.id}">Reservar</button></div>`).join("") : empty("La administración aún no configuró áreas")}
    <h2>Mis reservas</h2>
    ${act.length ? act.map(r => `<div class="card list"><div class="grow"><b>${esc(r.space)}</b> ${st(RSTAT, r.status)}<div class="mu sm">${fmtD(r.date)} · ${r.start}–${r.end} · ${r.people} pers.</div>${r.note ? `<div class="mu sm">${esc(r.note)}</div>` : ""}</div><button class="btn sm ghost" data-act="cancelres" data-id="${r.id}">Cancelar</button></div>`).join("") : empty("No tiene reservas activas")}
    ${other.length ? other.map(r => `<div class="card list"><div class="grow">${esc(r.space)} ${st(RSTAT, r.status)}<div class="mu sm">${fmtD(r.date)} · ${r.start}–${r.end}</div></div></div>`).join("") : ""}`;
};
ACT.book = el => {
  const s = S.spaces.find(x => x.id == el.dataset.id); S.bookSpace = s;
  const o = toMin(s.open_time), c = toMin(s.close_time);
  const opts = (from, to, sel) => { let h = ""; for (let m = from; m <= to; m += 30) h += `<option ${m === sel ? "selected" : ""}>${hhmm(m)}</option>`; return h; };
  modal(`<h2>Reservar ${esc(s.name)}</h2>
    <form data-form="book"><input type="hidden" name="space_id" value="${s.id}">
    <label>Fecha</label><input name="date" type="date" value="${today()}" min="${today()}" max="${addDays(today(), 60)}" id="bdate" required>
    <div id="bday" class="mt"></div>
    <div class="grid2"><div><label>Desde</label><select name="start">${opts(o, c - 30, o)}</select></div><div><label>Hasta</label><select name="end">${opts(o + 30, c, Math.min(o + 60, c))}</select></div></div>
    ${s.exclusive ? `<input type="hidden" name="people" value="1">` : `<label>Personas (máx. ${s.capacity})</label><input name="people" type="number" min="1" max="${s.capacity}" value="1">`}
    <label>Nota (opcional)</label><input name="note" maxlength="300">
    ${s.rules ? `<div class="notice info"><b>Reglas:</b> ${esc(s.rules)}</div>` : ""}
    ${s.requires_approval ? `<div class="notice">Esta área requiere aprobación de la administración.</div>` : ""}
    <div class="btns"><button class="btn">Reservar</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
  const load = () => dayView(s, $("#bdate").value);
  $("#bdate").addEventListener("change", load); load();
};
async function dayView(s, day) {
  const box = $("#bday"); if (!box) return;
  const d = await api(`spaces/${s.id}/day?day=${day}`);
  const o = toMin(s.open_time), c = toMin(s.close_time), span = c - o;
  box.innerHTML = `<div class="mu sm">Ocupación (${fmtD(day).toLowerCase()})${s.exclusive ? "" : " (las barras pueden superponerse si hay cupo)"}:</div>
    <div class="timeline">${d.reservations.map(r => `<div class="slot ${r.mine ? "mine" : r.status === "pendiente" ? "pend" : ""}" style="left:${(toMin(r.start) - o) / span * 100}%;width:${(toMin(r.end) - toMin(r.start)) / span * 100}%" title="${r.start}–${r.end}"></div>`).join("")}</div>
    <div class="tl-labels"><span>${s.open_time}</span><span>${hhmm(o + Math.round(span / 2 / 30) * 30)}</span><span>${s.close_time}</span></div>
    ${d.reservations.length ? `<div class="mu sm mt">${d.reservations.map(r => `${r.start}–${r.end}${s.exclusive ? "" : ` (${r.people} p.)`}${r.mine ? " · suya" : ""}`).join(" · ")}</div>` : `<div class="mu sm mt">Libre todo el día</div>`}`;
}
FORM.book = async (f, d) => {
  d.people = +d.people || 1; d.space_id = +d.space_id;
  const r = await api("reservations", { method: "POST", body: d });
  closeModal(); toast(r.status === "pendiente" ? "Solicitud enviada: pendiente de aprobación" : "¡Reserva confirmada! ✅"); refresh("reservas");
};
ACT.cancelres = async el => { if (!confirm("¿Cancelar esta reserva?")) return; await api("reservations/" + el.dataset.id, { method: "DELETE" }); toast("Reserva cancelada"); show(S.tab); };

// --- assistant (bot du règlement)
const SUGG = ["¿Hasta qué hora puedo usar la piscina?", "¿Puedo tener mascotas?", "¿Cuál es el horario de silencio?", "¿Cómo reservo el área de BBQ?", "¿Dónde puedo estacionar a mis visitas?"];
VIEW.asistente = async () => {
  const ms = await api("bot/messages");
  ms.filter(m => m.status === "pending").forEach(m => waitAnswer(m.id));
  return `<div class="notice info">Pregúntele al asistente sobre el reglamento de la residencia. Responde solo con lo que dice el reglamento cargado por la administración.</div>
    <div class="chat" id="chat">${ms.map(msgHtml).join("")}</div>
    ${ms.length ? "" : `<div class="sugg">${SUGG.map(s => `<button data-act="sugg">${esc(s)}</button>`).join("")}</div>`}
    <form data-form="ask" class="chatbar"><input name="question" placeholder="Escriba su pregunta…" maxlength="600" autocomplete="off" required><button class="btn">Enviar</button></form>`;
};
POST.asistente = () => { const c = $("#chat"); if (c && c.lastElementChild) c.lastElementChild.scrollIntoView({ block: "end" }); };
function msgHtml(m) {
  let a;
  if (m.status === "pending") a = `<div class="msg a typing" id="m${m.id}">Buscando en el reglamento…</div>`;
  else a = `<div class="msg a" id="m${m.id}">${esc(m.answer)}${m.sources && m.sources.length ? `<details><summary>Fuentes (${m.sources.length})</summary>${m.sources.map(s => `<p><b>${esc(s.title)}:</b> ${esc(s.text)}…</p>`).join("")}</details>` : ""}
    ${m.status === "done" ? `<div class="mt sm">${m.helpful ? (m.helpful > 0 ? "👍 Gracias" : "👎 Gracias, lo revisaremos") : `<button class="btn ghost sm" data-act="fb" data-id="${m.id}" data-v="1">👍</button><button class="btn ghost sm" data-act="fb" data-id="${m.id}" data-v="-1">👎</button>`}</div>` : ""}</div>`;
  return `<div class="msg q">${esc(m.question)}</div>${a}`;
}
FORM.ask = async (f, d) => {
  const m = await api("bot/ask", { method: "POST", body: { question: d.question } });
  f.reset(); const sg = $(".sugg"); if (sg) sg.remove();
  $("#chat").insertAdjacentHTML("beforeend", msgHtml(m)); $("#m" + m.id).scrollIntoView({ block: "end" });
  waitAnswer(m.id);
};
ACT.sugg = el => { const f = $("form[data-form=ask]"); f.question.value = el.textContent; f.requestSubmit(); };
ACT.fb = async el => { await api(`bot/messages/${el.dataset.id}/feedback`, { method: "POST", body: { helpful: +el.dataset.v } }); el.parentElement.textContent = +el.dataset.v > 0 ? "👍 Gracias" : "👎 Gracias, lo revisaremos"; };
function updateChat(m) { S.chatWait.delete(m.id); const el = $("#m" + m.id); if (!el) return; el.previousElementSibling.remove(); el.outerHTML = msgHtml(m); const n = $("#m" + m.id); if (n) n.scrollIntoView({ block: "end" }); }
function waitAnswer(id) {
  // filet de sécurité si le temps réel ne passe pas : on interroge toutes les 3 s
  if (S.chatWait.has(id)) return; S.chatWait.add(id);
  const t = setInterval(async () => {
    if (!S.chatWait.has(id)) return clearInterval(t);
    try { const m = await api("bot/messages/" + id); if (m.status !== "pending") { clearInterval(t); updateChat(m); } } catch { clearInterval(t); S.chatWait.delete(id); }
  }, 3000);
  S.timers.push(t);
}

// --- plus (résident, portería, admin)
VIEW.mas = async () => {
  const r = S.me.role;
  const items = { resident: [["tickets", "Solicitudes y reportes"], ["perfil", "Mi perfil"]], guard: [["tickets", "Reportes"], ["perfil", "Mi perfil"]],
    admin: [["residencia", "Residencia"], ["registro", "Registro de accesos"], ["alertas", "Historial de alertas"], ["perfil", "Mi perfil"]], superadmin: [["perfil", "Mi perfil"]] }[r];
  const cur = segv("mas", items[0][0]);
  let body = "";
  if (cur === "tickets") body = await ticketsView(true);
  else if (cur === "perfil") body = profileView();
  else if (cur === "residencia") body = await residenceView();
  else if (cur === "registro") body = await VIEW.registro();
  else if (cur === "alertas") body = await VIEW.alertas();
  return seg("mas", items) + body;
};
POST.mas = () => { if (segv("mas") === "registro") POST.registro(); };
function profileView() {
  return `<div class="card"><b>${esc(S.me.name)}</b><div class="mu">${esc(S.me.email)}</div><div class="mu sm">${ROLE[S.me.role]}${S.me.unit ? " · " + esc(S.me.unit) : ""}</div></div>
    <form data-form="profile" class="card"><label>Teléfono (lo ve la portería si usa el botón de pánico)</label><input name="phone" type="tel" value="${esc(S.me.phone)}"><button class="btn sm mt">Guardar</button></form>
    <form data-form="pw" class="card"><h3>Cambiar contraseña</h3><label>Actual</label><input name="current" type="password" required><label>Nueva (mín. 8)</label><input name="new" type="password" minlength="8" required><button class="btn sm mt">Cambiar</button></form>
    <button class="btn redl block" data-act="logout">Cerrar sesión</button>
    <p class="mu sm center mt">Vecino · versión 1.0</p>`;
}
FORM.profile = async (f, d) => { await api("me/profile", { method: "POST", body: d }); S.me.phone = d.phone; toast("Guardado"); };
FORM.pw = async (f, d) => { const r = await api("me/password", { method: "POST", body: d }); if (r.token) setToken(r.token); f.reset(); toast("Contraseña actualizada"); };
ACT.logout = async () => { await api("logout", { method: "POST" }).catch(() => { }); setToken(""); S.tab = null; S.seg = {}; history.replaceState(null, "", location.pathname); showLogin(); };

// --- tickets (résident / portería / admin)
async function ticketsView(canCreate) {
  const ts = await api("tickets");
  return `${canCreate ? `<button class="btn block" data-act="newticket">＋ Nueva solicitud o reporte</button>` : ""}
    <div class="mt">${ts.length ? ts.map(t => `<div class="card list" data-act="ticket" data-id="${t.id}" style="cursor:pointer"><div class="grow"><b>${esc(t.title)}</b> ${st(TSTAT, t.status)}<div class="mu sm">${CATS[t.category] || t.category}${S.me.role === "admin" ? ` · ${esc(t.unit || ROLE.guard)} · ${esc(t.user || "")}` : ""} · ${ago(t.updated_at)}</div></div><span class="mu">›</span></div>`).join("") : empty("No hay solicitudes")}</div>`;
}
ACT.newticket = () => modal(`<h2>Nueva solicitud</h2><form data-form="ticket">
  <label>Categoría</label><select name="category">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
  <label>Título</label><input name="title" required maxlength="200" placeholder="Ej.: fuga de agua en el pasillo del piso 3">
  <label>Descripción</label><textarea name="description" maxlength="5000"></textarea>
  <div class="btns"><button class="btn">Enviar</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
FORM.ticket = async (f, d) => { await api("tickets", { method: "POST", body: d }); closeModal(); toast("Solicitud enviada a la administración"); show(S.tab); };
ACT.ticket = async el => {
  const t = await api("tickets/" + el.dataset.id);
  const admin = S.me.role === "admin";
  modal(`<h2>${esc(t.title)}</h2><div class="mu sm">${CATS[t.category]} · ${esc(t.unit || "")} · ${esc(t.user || "")} · ${fmtDT(t.created_at)}</div>
    <div class="mt">${admin ? `<select data-tid="${t.id}" id="tstatus">${Object.entries(TSTAT).map(([k, v]) => `<option value="${k}" ${k === t.status ? "selected" : ""}>${v[0]}</option>`).join("")}</select>` : st(TSTAT, t.status)}</div>
    ${t.description ? `<p style="white-space:pre-wrap">${esc(t.description)}</p>` : ""}
    <h3 class="mt">Comentarios</h3>
    ${t.comments.length ? t.comments.map(c => `<div class="card sm"><b>${esc(c.user || "")}</b> ${c.role === "admin" ? pill("Administración", "blu") : ""} <span class="mu">${ago(c.created_at)}</span><div style="white-space:pre-wrap">${esc(c.body)}</div></div>`).join("") : `<p class="mu sm">Sin comentarios</p>`}
    <form data-form="comment" data-id="${t.id}"><textarea name="body" required placeholder="Escribir un comentario…" style="min-height:60px"></textarea>
    <div class="btns"><button class="btn sm">Comentar</button><button type="button" class="btn sm sec" data-act="close">Cerrar</button></div></form>`);
  const sel = $("#tstatus");
  if (sel) sel.addEventListener("change", async () => { try { await api(`tickets/${t.id}/status`, { method: "POST", body: { status: sel.value } }); toast("Estado actualizado"); show(S.tab); } catch (e) { fail(e); } });
};
FORM.comment = async (f, d) => { await api(`tickets/${f.dataset.id}/comments`, { method: "POST", body: d }); ACT.ticket({ dataset: { id: f.dataset.id } }); };

// ---------------------------------------------------------------- PORTERÍA
VIEW.porteria = async () => {
  const d = await api("guard/today");
  S.guard = d;
  const reqs = d.requests.filter(r => r.status === "pendiente" || (r.status === "autorizada" && r.visit_id && !d.inside.find(v => v.id === r.visit_id) && d.expected.find(v => v.id === r.visit_id)));
  const others = d.requests.filter(r => !reqs.includes(r)).slice(0, 6);
  return `<div class="card">
      <form data-form="lookup" class="row"><input name="code" placeholder="Código de visita" autocapitalize="characters" autocomplete="off" style="font:700 20px ui-monospace,monospace;letter-spacing:3px;text-transform:uppercase" maxlength="20" required><button class="btn">Verificar</button></form>
      <div class="btns"><button class="btn sec" data-act="scan">📷 Escanear QR</button><button class="btn sec" data-act="unexpected">🔔 Visitante sin aviso</button><button class="btn ghost" data-act="manuallog">✎ Anotar</button></div>
      ${S.audio ? "" : `<div class="notice">Toque cualquier botón una vez para activar el sonido de las alertas.</div>`}
    </div>
    ${reqs.length ? `<h2>Solicitudes al residente</h2>${reqs.map(r => `<div class="card list"><div class="grow"><b>${esc(r.visitor_name)}</b> → ${esc(r.unit)} ${st(QSTAT, r.status)}<div class="mu sm">${KIND[r.kind]} · ${ago(r.created_at)}</div></div>${r.status === "autorizada" ? `<button class="btn sm" data-act="admit" data-id="${r.id}">Dejar pasar</button>` : ""}</div>`).join("")}` : ""}
    <h2>Esperadas hoy (${d.expected.length})</h2>
    ${d.expected.length ? d.expected.map(v => `<div class="card list"><div class="grow"><b>${esc(v.visitor_name)}</b> → ${esc(v.unit)}<div class="mu sm">${KIND[v.kind]}${v.time_from ? " · " + v.time_from + (v.time_to ? "–" + v.time_to : "") : ""}${v.plate ? " · 🚗 " + esc(v.plate) : ""}${v.doc_id ? " · ID " + esc(v.doc_id) : ""}</div>${v.notes ? `<div class="mu sm">${esc(v.notes)}</div>` : ""}</div><button class="btn sm" data-act="checkin" data-id="${v.id}">Entrada</button></div>`).join("") : empty("Ninguna visita anunciada para hoy")}
    <h2>Dentro ahora (${d.inside.length})</h2>
    ${d.inside.length ? d.inside.map(v => `<div class="card list"><div class="grow"><b>${esc(v.visitor_name)}</b> → ${esc(v.unit)}<div class="mu sm">${KIND[v.kind]} · entró ${fmtT(v.entered_at)}${v.plate ? " · 🚗 " + esc(v.plate) : ""}</div></div><button class="btn sm sec" data-act="checkout" data-id="${v.id}">Salida</button></div>`).join("") : empty("Nadie registrado dentro")}
    ${others.length ? `<h2>Respuestas recientes</h2>${others.map(r => `<div class="card list sm"><div class="grow">${esc(r.visitor_name)} → ${esc(r.unit)} · ${ago(r.created_at)}</div>${st(QSTAT, r.status)}</div>`).join("")}` : ""}`;
};
FORM.lookup = async (f, d) => lookupCode(d.code);
async function lookupCode(code) {
  let r;
  try { r = await api("guard/lookup", { method: "POST", body: { code } }); }
  catch (e) { if (e.status === 404) { beep(1); return modal(`<h2>❌ Código no válido</h2><p>El código <b>${esc(code.toUpperCase())}</b> no existe en esta residencia.</p><div class="btns"><button class="btn sec" data-act="unexpected">Llamar al residente</button><button class="btn sec" data-act="close">Cerrar</button></div>`); } throw e; }
  const v = r.visit;
  modal(`<h2>${r.can_enter ? "✅ Visita válida" : "⚠️ Atención"}</h2>
    ${r.warning ? `<div class="notice">${esc(r.warning)}</div>` : ""}
    <div class="card"><div class="big"><b style="font-size:20px">${esc(v.visitor_name)}</b></div><div>→ <b>${esc(v.unit)}</b></div><div class="mu sm">${KIND[v.kind]} · ${fmtD(v.date)}${v.time_from ? " · " + v.time_from + (v.time_to ? "–" + v.time_to : "") : ""}${v.doc_id ? " · ID " + esc(v.doc_id) : ""}</div>${v.notes ? `<div class="sm mt">📝 ${esc(v.notes)}</div>` : ""}</div>
    ${r.can_enter ? `<form data-form="checkin"><input type="hidden" name="visit_id" value="${v.id}"><label>Placa (opcional)</label><input name="plate" value="${esc(v.plate)}" maxlength="20"><div class="btns"><button class="btn">Registrar entrada</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`
      : v.status === "dentro" ? `<div class="btns"><button class="btn" data-act="checkout" data-id="${v.id}">Registrar salida</button><button class="btn sec" data-act="close">Cerrar</button></div>` : `<div class="btns"><button class="btn sec" data-act="close">Cerrar</button></div>`}`);
}
ACT.checkin = el => { const v = S.guard.expected.find(x => x.id == el.dataset.id); lookupCode(v.code); };
FORM.checkin = async (f, d) => { const v = await api("guard/checkin", { method: "POST", body: { visit_id: +d.visit_id, plate: d.plate || "" } }); closeModal(); toast(`Entrada registrada: ${v.visitor_name}`); refresh("porteria"); };
ACT.checkout = async el => { const v = await api("guard/checkout", { method: "POST", body: { visit_id: +el.dataset.id } }); closeModal(); toast(`Salida registrada: ${v.visitor_name}`); refresh("porteria"); };
ACT.admit = async el => { const v = await api(`guard/requests/${el.dataset.id}/admit`, { method: "POST", body: { plate: "" } }); toast(`Entrada registrada: ${v.visitor_name}`); refresh("porteria"); };
async function unitsOptions() { if (!S.units) S.units = await api("admin/units"); return S.units.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join(""); }
ACT.unexpected = async () => modal(`<h2>Visitante sin aviso</h2><p class="mu sm">El residente recibe una notificación en la app para autorizar o rechazar. Si no responde en 15 min, la solicitud expira: llámelo por teléfono.</p>
  <form data-form="unexpected"><label>Unidad</label><select name="unit_id" required>${await unitsOptions()}</select>
  <label>Nombre del visitante</label><input name="visitor_name" required maxlength="160">
  <label>Tipo</label><select name="kind"><option value="visita">Visita</option><option value="delivery">Delivery</option><option value="servicio">Servicio</option></select>
  <label>Nota (opcional)</label><input name="note" maxlength="300" placeholder="Ej.: paquete de Amazon">
  <div class="btns"><button class="btn">Avisar al residente</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
FORM.unexpected = async (f, d) => {
  d.unit_id = +d.unit_id; const r = await api("guard/requests", { method: "POST", body: d });
  closeModal(); toast(r.unit_has_residents ? "Solicitud enviada. Esperando respuesta…" : "⚠️ Esta unidad no tiene residentes con cuenta: llame por teléfono", !r.unit_has_residents, 6000); refresh("porteria");
};
ACT.manuallog = async () => modal(`<h2>Anotar en el registro</h2><p class="mu sm">Para movimientos sin código (proveedor del edificio, residente sin tarjeta…).</p>
  <form data-form="manuallog"><label>Nombre</label><input name="person_name" required maxlength="160">
  <div class="grid2"><div><label>Movimiento</label><select name="direction"><option value="entrada">Entrada</option><option value="salida">Salida</option></select></div><div><label>Tipo</label><select name="kind"><option value="visita">Visita</option><option value="servicio">Servicio</option><option value="delivery">Delivery</option></select></div></div>
  <label>Unidad (opcional)</label><select name="unit_id"><option value="">—</option>${await unitsOptions()}</select>
  <div class="grid2"><div><label>Placa</label><input name="plate" maxlength="20"></div><div><label>Nota</label><input name="note" maxlength="300"></div></div>
  <div class="btns"><button class="btn">Guardar</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
FORM.manuallog = async (f, d) => { d.unit_id = d.unit_id ? +d.unit_id : null; await api("guard/manual-log", { method: "POST", body: d }); closeModal(); toast("Anotado en el registro"); };

// scan QR (BarcodeDetector : Chrome/Android ; sinon saisie manuelle)
ACT.scan = async () => {
  if (!("BarcodeDetector" in window)) return toast("Este navegador no puede leer QR. Escriba el código de 6 caracteres.", true, 5000);
  modal(`<h2>Escanear QR</h2><video class="scan" id="scanv" playsinline muted></video><p class="mu sm center">Apunte la cámara al código QR del visitante</p><div class="btns"><button class="btn sec block" data-act="close">Cancelar</button></div>`);
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } }); }
  catch { closeModal(); return toast("No se pudo abrir la cámara (permiso denegado)", true); }
  const v = $("#scanv"); v.srcObject = stream; await v.play();
  const det = new BarcodeDetector({ formats: ["qr_code"] }); let stop = false;
  S.scanStop = () => { stop = true; stream.getTracks().forEach(t => t.stop()); S.scanStop = null; };
  const loop = async () => {
    if (stop) return;
    try { const codes = await det.detect(v); if (codes.length) { const raw = codes[0].rawValue || ""; S.scanStop(); vibrate(80); closeModal(); return lookupCode(raw.replace(/^VECINO:/i, "")); } } catch { }
    setTimeout(loop, 250);
  };
  loop();
};

// --- registre
VIEW.registro = async () => {
  const day = S.logDay || today();
  const d = await api("admin/access-log?day=" + day);
  return `<div class="row"><input type="date" id="logday" value="${day}" max="${today()}"><button class="btn sec" data-act="printlog">Imprimir</button></div>
    <div class="card mt scroll">${d.events.length ? `<table><tr><th>Hora</th><th></th><th>Persona</th><th>Unidad</th><th>Placa</th></tr>${d.events.map(e => `<tr><td>${fmtT(e.at)}</td><td>${e.direction === "entrada" ? "⬇️ Entrada" : "⬆️ Salida"}</td><td>${esc(e.person_name)}<div class="mu">${KIND[e.kind] || ""}${e.note ? " · " + esc(e.note) : ""}</div></td><td>${esc(e.unit || "")}</td><td>${esc(e.plate)}</td></tr>`).join("")}</table>` : empty("Sin movimientos este día")}</div>`;
};
POST.registro = () => { const i = $("#logday"); if (i) i.addEventListener("change", () => { S.logDay = i.value; show(S.tab); }); };
ACT.printlog = () => window.print();

// --- alertes (portería / admin)
async function pollAlerts() {
  if (!(S.me && (S.me.role === "guard" || S.me.role === "admin"))) return;
  try { S.alerts = await api("panic/active"); } catch { return; }
  badge("alertas", S.alerts.length); badge("panel", S.alerts.length);
  renderAlarm();
}
function renderAlarm() {
  const box = $("#alarm");
  const newOnes = S.alerts.filter(a => !a.acknowledged_at);
  if (!newOnes.length) { box.hidden = true; clearInterval(S.alarmBeep); S.alarmBeep = null; return; }
  box.innerHTML = `<h1>🚨 ALERTA DE PÁNICO</h1><p>${newOnes.length > 1 ? newOnes.length + " alertas activas" : "Un residente pidió ayuda"}</p>
    ${newOnes.map(a => `<div class="card"><div class="big">${esc(a.unit || "Sin unidad")}</div><div><b>${esc(a.user || "")}</b> · ${ago(a.created_at)}</div>${a.message ? `<div class="mt">📝 ${esc(a.message)}</div>` : ""}
      <div class="btns">${a.phone ? `<a class="btn sec" href="tel:${esc(a.phone)}">📞 Llamar ${esc(a.phone)}</a>` : ""}<button class="btn red" data-act="ack" data-id="${a.id}">Atendiendo</button></div></div>`).join("")}
    ${S.audio ? "" : `<button class="btn sec" data-act="sound">🔊 Activar sonido</button>`}
    <p class="sm">Si es grave, llame al 911. «Atendiendo» avisa al residente que la portería está en camino.</p>`;
  box.hidden = false; vibrate([500, 200, 500]);
  if (!S.alarmBeep) { beep(4); S.alarmBeep = setInterval(() => beep(4), 2500); }
}
ACT.sound = () => { unlockAudio(); beep(2); renderAlarm(); };
ACT.ack = async el => { await api(`panic/${el.dataset.id}/ack`, { method: "POST" }); await pollAlerts(); toast("Residente avisado: está atendiendo"); show(S.tab); };
ACT.resolve = el => modal(`<h2>Cerrar alerta</h2><form data-form="resolve" data-id="${el.dataset.id}"><label>¿Qué pasó? (queda en el historial)</label><textarea name="note" placeholder="Ej.: falsa alarma / se acompañó al residente / se llamó a la policía"></textarea><div class="btns"><button class="btn">Cerrar alerta</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
FORM.resolve = async (f, d) => { await api(`panic/${f.dataset.id}/resolve`, { method: "POST", body: d }); closeModal(); await pollAlerts(); toast("Alerta cerrada"); show(S.tab); };
const alertCard = a => `<div class="card"><div class="row"><div class="grow"><b>${esc(a.unit || "Sin unidad")}</b> · ${esc(a.user || "")} ${a.resolved_at ? pill("Cerrada", "gray") : a.acknowledged_at ? pill("Atendiendo", "amb") : pill("NUEVA", "red")}
  <div class="mu sm">${fmtDT(a.created_at)}${a.phone ? " · " + esc(a.phone) : ""}${a.sms_status ? " · SMS: " + esc(a.sms_status) : ""}</div>${a.message ? `<div class="sm">📝 ${esc(a.message)}</div>` : ""}${a.resolution_note ? `<div class="sm mu">✔ ${esc(a.resolution_note)}</div>` : ""}</div>
  ${a.resolved_at ? "" : `<div class="btns" style="margin:0">${a.acknowledged_at ? "" : `<button class="btn sm red" data-act="ack" data-id="${a.id}">Atendiendo</button>`}<button class="btn sm sec" data-act="resolve" data-id="${a.id}">Cerrar</button></div>`}</div></div>`;
VIEW.alertas = async () => {
  const h = await api("panic/history");
  const open = h.filter(a => !a.resolved_at), closed = h.filter(a => a.resolved_at);
  return `<h2>Activas</h2>${open.length ? open.map(alertCard).join("") : empty("Ninguna alerta activa ✅")}<h2>Historial</h2>${closed.length ? closed.slice(0, 50).map(alertCard).join("") : empty("Sin historial")}`;
};

// ---------------------------------------------------------------- ADMINISTRATION
VIEW.panel = async () => {
  const [s, pend, alerts] = await Promise.all([api("admin/stats"), api("admin/reservations?status=pendiente"), api("panic/active")]);
  const stat = (n, l, w) => `<div class="stat ${w && n ? "warn" : ""}"><b>${n}</b><span class="mu sm">${l}</span></div>`;
  return `<div class="stats">${stat(s.alerts_open, "Alertas abiertas", 1)}${stat(s.visits_today, "Visitas hoy")}${stat(s.inside_now, "Visitantes dentro")}${stat(s.reservations_pending, "Reservas por aprobar", 1)}${stat(s.tickets_open, "Solicitudes abiertas")}${stat(s.residents, "Residentes")}${stat(s.units, "Unidades")}</div>
    ${alerts.length ? `<h2>🚨 Alertas activas</h2>${alerts.map(alertCard).join("")}` : ""}
    ${pend.length ? `<h2>Reservas por aprobar</h2>${pend.map(resAdminCard).join("")}` : ""}
    ${!s.units ? `<div class="notice info"><b>Primeros pasos:</b> 1) cree las unidades y residentes en «Residentes», 2) configure las áreas en «Áreas», 3) cargue el reglamento en «Comunidad → Reglamento», 4) cree la cuenta de la portería (rol Portería).</div>` : ""}`;
};
const resAdminCard = r => `<div class="card list"><div class="grow"><b>${esc(r.space)}</b> · ${esc(r.unit)} ${st(RSTAT, r.status)}<div class="mu sm">${fmtD(r.date)} · ${r.start}–${r.end} · ${r.people} pers.</div>${r.note ? `<div class="mu sm">${esc(r.note)}</div>` : ""}</div>
  <div class="btns" style="margin:0">${r.status === "pendiente" ? `<button class="btn sm" data-act="decide" data-id="${r.id}" data-ok="1">Aprobar</button><button class="btn sm redl" data-act="decide" data-id="${r.id}" data-ok="0">Rechazar</button>` : r.status === "confirmada" ? `<button class="btn sm ghost" data-act="cancelres" data-id="${r.id}">Cancelar</button>` : ""}</div></div>`;
ACT.decide = async el => { await api(`admin/reservations/${el.dataset.id}/decide`, { method: "POST", body: { approve: el.dataset.ok === "1" } }); toast(el.dataset.ok === "1" ? "Reserva aprobada" : "Reserva rechazada"); show(S.tab); };

// --- residents & unités
VIEW.gente = async () => {
  const cur = segv("gente", "users");
  const head = seg("gente", [["users", "Usuarios"], ["units", "Unidades"]]);
  if (cur === "units") {
    const units = await api("admin/units"); S.units = units;
    return head + `<form data-form="units" class="card"><h3>Agregar unidades</h3>
      <div class="grid2"><div><label>Prefijo</label><input name="prefix" placeholder="Ej.: Torre A - "></div><div><label>Del … al …</label><div class="row"><input name="from" type="number" placeholder="101"><input name="to" type="number" placeholder="120"></div></div></div>
      <label>…o una por línea</label><textarea name="list" placeholder="Casa 1&#10;Casa 2&#10;PH-A"></textarea><button class="btn sm mt">Agregar</button></form>
      <h2>${units.length} unidades</h2><div class="card">${units.length ? units.map(u => `<span class="pill gray" style="margin:2px">${esc(u.name)} <a href="#" data-act="delunit" data-id="${u.id}" title="Eliminar">×</a></span>`).join("") : "Aún no hay unidades"}</div>`;
  }
  const [users, units] = await Promise.all([api("admin/users"), api("admin/units")]); S.units = units; S.users = users;
  const q = (S.userQ || "").toLowerCase();
  const list = users.filter(u => !q || (u.name + u.email + (u.unit || "")).toLowerCase().includes(q));
  return head + `<div class="row"><input id="userq" placeholder="Buscar por nombre, correo o unidad" value="${esc(S.userQ || "")}"><button class="btn" data-act="newuser">＋ Usuario</button></div>
    <div class="mt">${list.map(u => `<div class="card list" data-act="edituser" data-id="${u.id}" style="cursor:pointer${u.active ? "" : ";opacity:.55"}"><div class="grow"><b>${esc(u.name)}</b> ${u.role !== "resident" ? pill(ROLE[u.role], "blu") : ""} ${u.active ? "" : pill("Inactivo", "gray")} ${u.must_change_password ? pill("Sin activar", "amb") : ""}<div class="mu sm">${esc(u.unit || "")}${u.unit ? " · " : ""}${esc(u.email)}${u.phone ? " · " + esc(u.phone) : ""}</div></div><span class="mu">›</span></div>`).join("") || empty("Sin resultados")}</div>`;
};
POST.gente = () => { const i = $("#userq"); if (i) { i.addEventListener("input", () => { S.userQ = i.value; clearTimeout(S.uqT); S.uqT = setTimeout(() => { show("gente").then(() => { const j = $("#userq"); j.focus(); j.setSelectionRange(j.value.length, j.value.length); }); }, 300); }); } };
FORM.units = async (f, d) => {
  let names = (d.list || "").split("\n").map(s => s.trim()).filter(Boolean);
  if (d.from && d.to) { const a = +d.from, b = +d.to; if (b - a > 500 || b < a) throw new Error("Rango no válido (máx. 500)"); for (let i = a; i <= b; i++) names.push((d.prefix || "") + i); }
  if (!names.length) throw new Error("Indique al menos una unidad");
  const r = await api("admin/units", { method: "POST", body: { names } }); S.units = null; toast(`${r.added.length} unidad(es) agregada(s)`); show("gente");
};
ACT.delunit = async el => { if (!confirm("¿Eliminar esta unidad?")) return; await api("admin/units/" + el.dataset.id, { method: "DELETE" }); S.units = null; show("gente"); };
const unitSel = (sel) => `<select name="unit_id"><option value="">— (sin unidad)</option>${(S.units || []).map(u => `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${esc(u.name)}</option>`).join("")}</select>`;
ACT.newuser = () => modal(`<h2>Nuevo usuario</h2><form data-form="newuser">
  <label>Nombre completo</label><input name="name" required maxlength="160">
  <label>Correo (será su usuario)</label><input name="email" type="email" required>
  <label>Teléfono / WhatsApp</label><input name="phone" type="tel" placeholder="+507 6…">
  <label>Rol</label><select name="role"><option value="resident">Residente</option><option value="guard">Portería (guardia)</option><option value="admin">Administración</option></select>
  <label>Unidad (residentes)</label>${unitSel(null)}
  <div class="btns"><button class="btn">Crear</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
FORM.newuser = async (f, d) => { d.unit_id = d.unit_id ? +d.unit_id : null; const r = await api("admin/users", { method: "POST", body: d }); credModal(r.user, r.temp_password); show("gente"); };
function credModal(u, pw) {
  const link = location.origin + location.pathname;
  const msg = `Hola ${u.name}, ya tienes acceso a la app de ${S.res.name}:\n${link}\nUsuario: ${u.email}\nContraseña temporal: ${pw}\n(La app te pedirá cambiarla al entrar.)`;
  modal(`<h2>Acceso creado ✅</h2><p>Comparta estos datos con <b>${esc(u.name)}</b>. La contraseña temporal no se volverá a mostrar.</p>
    <div class="card"><div class="mu sm">Usuario</div><b>${esc(u.email)}</b><div class="mu sm mt">Contraseña temporal</div><div class="code">${esc(pw)}</div></div>
    <div class="btns">${u.phone ? `<a class="btn" target="_blank" href="https://wa.me/${esc(u.phone.replace(/\D/g, ""))}?text=${encodeURIComponent(msg)}">Enviar por WhatsApp</a>` : ""}<button class="btn sec" data-act="copycred" data-msg="${esc(msg)}">Copiar mensaje</button><button class="btn sec" data-act="close">Listo</button></div>`);
}
ACT.copycred = async el => { try { await navigator.clipboard.writeText(el.dataset.msg); toast("Copiado"); } catch { toast("No se pudo copiar", true); } };
ACT.edituser = el => {
  const u = S.users.find(x => x.id == el.dataset.id);
  modal(`<h2>${esc(u.name)}</h2><div class="mu">${esc(u.email)}</div><form data-form="edituser" data-id="${u.id}">
    <label>Nombre</label><input name="name" value="${esc(u.name)}" required>
    <label>Teléfono</label><input name="phone" value="${esc(u.phone)}">
    <label>Rol</label><select name="role">${["resident", "guard", "admin"].map(r => `<option value="${r}" ${r === u.role ? "selected" : ""}>${ROLE[r]}</option>`).join("")}</select>
    <label>Unidad</label>${unitSel(u.unit_id)}
    <label class="check"><input type="checkbox" name="active" ${u.active ? "checked" : ""}> Cuenta activa</label>
    <div class="btns"><button class="btn">Guardar</button><button type="button" class="btn sec" data-act="resetpw" data-id="${u.id}">Restablecer contraseña</button><button type="button" class="btn ghost" data-act="close">Cerrar</button></div></form>`);
};
FORM.edituser = async (f, d) => {
  const body = { name: d.name, phone: d.phone, role: d.role, unit_id: d.unit_id ? +d.unit_id : null, active: !!d.active };
  await api("admin/users/" + f.dataset.id, { method: "PUT", body }); closeModal(); toast("Guardado"); show("gente");
};
ACT.resetpw = async el => { if (!confirm("¿Generar una nueva contraseña temporal?")) return; const r = await api(`admin/users/${el.dataset.id}/reset-password`, { method: "POST" }); credModal(S.users.find(x => x.id == el.dataset.id), r.temp_password); };

// --- espaces & réservations (admin)
VIEW.areas = async () => {
  const cur = segv("areas", "res");
  const head = seg("areas", [["res", "Reservas"], ["spaces", "Configurar áreas"]]);
  if (cur === "spaces") {
    const sp = await api("admin/spaces"); S.aspaces = sp;
    return head + `<button class="btn block" data-act="editspace">＋ Nueva área</button><div class="mt">${sp.map(s => `<div class="card list" data-act="editspace" data-id="${s.id}" style="cursor:pointer${s.active ? "" : ";opacity:.55"}"><div class="grow"><b>${esc(s.name)}</b> ${s.active ? "" : pill("Desactivada", "gray")}<div class="mu sm">${s.open_time}–${s.close_time} · máx. ${s.max_hours} h · ${s.exclusive ? "exclusivo" : "cupo " + s.capacity}${s.max_per_week ? ` · ${s.max_per_week}/semana` : ""}${s.requires_approval ? " · con aprobación" : ""}</div></div><span class="mu">›</span></div>`).join("") || empty("Sin áreas")}</div>`;
  }
  const rs = await api("admin/reservations");
  const pend = rs.filter(r => r.status === "pendiente"), rest = rs.filter(r => r.status !== "pendiente");
  return head + (pend.length ? `<h2>Por aprobar</h2>${pend.map(resAdminCard).join("")}` : "") + `<h2>Próximas reservas</h2>${rest.length ? rest.map(resAdminCard).join("") : empty("No hay reservas")}`;
};
ACT.editspace = el => {
  const s = (S.aspaces || []).find(x => x.id == el.dataset.id) || { name: "", description: "", open_time: "08:00", close_time: "22:00", max_hours: 2, exclusive: false, capacity: 10, max_per_week: 0, requires_approval: false, rules: "", active: true };
  modal(`<h2>${s.id ? "Editar área" : "Nueva área"}</h2><form data-form="space" data-id="${s.id || ""}">
    <label>Nombre</label><input name="name" value="${esc(s.name)}" required placeholder="Piscina, Gimnasio, Área BBQ…">
    <label>Descripción</label><input name="description" value="${esc(s.description)}">
    <div class="grid2"><div><label>Abre</label><input name="open_time" type="time" value="${s.open_time}" required></div><div><label>Cierra</label><input name="close_time" type="time" value="${s.close_time}" required></div></div>
    <div class="grid2"><div><label>Máx. horas por reserva</label><input name="max_hours" type="number" min="1" max="24" value="${s.max_hours}"></div><div><label>Máx. reservas/semana por unidad (0 = sin límite)</label><input name="max_per_week" type="number" min="0" value="${s.max_per_week}"></div></div>
    <label class="check"><input type="checkbox" name="exclusive" ${s.exclusive ? "checked" : ""}> Uso exclusivo (una sola reserva a la vez, ej. salón de fiestas, BBQ)</label>
    <label>Capacidad (personas a la vez, si no es exclusivo)</label><input name="capacity" type="number" min="1" value="${s.capacity}">
    <label class="check"><input type="checkbox" name="requires_approval" ${s.requires_approval ? "checked" : ""}> Requiere aprobación de la administración</label>
    <label>Reglas que verá el residente</label><textarea name="rules">${esc(s.rules)}</textarea>
    <label class="check"><input type="checkbox" name="active" ${s.active ? "checked" : ""}> Activa</label>
    <div class="btns"><button class="btn">Guardar</button><button type="button" class="btn sec" data-act="close">Cancelar</button></div></form>`);
};
FORM.space = async (f, d) => {
  const body = { ...d, max_hours: +d.max_hours, max_per_week: +d.max_per_week, capacity: +d.capacity, exclusive: !!d.exclusive, requires_approval: !!d.requires_approval, active: !!d.active };
  await api("admin/spaces" + (f.dataset.id ? "/" + f.dataset.id : ""), { method: f.dataset.id ? "PUT" : "POST", body }); closeModal(); toast("Área guardada"); show("areas");
};

// --- communauté (annonces, demandes, règlement)
VIEW.comunidad = async () => {
  const cur = segv("com", "anuncios");
  const head = seg("com", [["anuncios", "Anuncios"], ["tickets", "Solicitudes"], ["reglamento", "Reglamento y bot"]]);
  if (cur === "tickets") return head + await ticketsView(false);
  if (cur === "reglamento") {
    const [docs, bs] = await Promise.all([api("admin/rules"), api("admin/bot/stats")]);
    return head + `<div class="notice info">El asistente responde a los residentes usando <b>solo</b> estos documentos, más los horarios configurados en «Áreas». Si no encuentra la respuesta, lo dice y remite a la administración.</div>
      <form data-form="rules" class="card"><h3>Cargar reglamento</h3><label>Título</label><input name="title" placeholder="Reglamento interno 2025">
      <label>Archivo PDF, TXT o MD</label><input name="file" type="file" accept=".pdf,.txt,.md">
      <label>…o pegue el texto</label><textarea name="text" placeholder="Artículo 1. …"></textarea><button class="btn sm mt">Cargar</button></form>
      <h2>Documentos</h2>${docs.length ? docs.map(d => `<div class="card list"><div class="grow"><b>${esc(d.title)}</b><div class="mu sm">${esc(d.filename || "texto")} · ${d.chunks} fragmentos · ${Math.round(d.chars / 1000)}k caracteres</div></div><button class="btn sm ghost" data-act="viewrule" data-id="${d.id}">Ver</button><button class="btn sm ghost" data-act="delrule" data-id="${d.id}">Eliminar</button></div>`).join("") : empty("Aún no hay reglamento cargado")}
      <h2>Últimas preguntas al asistente</h2><div class="card">${bs.recent.length ? `<table>${bs.recent.map(m => `<tr><td>${esc(m.question)}</td><td class="right">${m.helpful > 0 ? "👍" : m.helpful < 0 ? "👎" : ""}</td><td class="mu">${ago(m.created_at)}</td></tr>`).join("")}</table>` : `<span class="mu">Sin preguntas todavía</span>`}</div>
      <p class="mu sm">Las preguntas con 👎 indican temas que el reglamento no cubre bien. Pruebe el asistente usted mismo: <a href="#" data-act="tab" data-tab="asistente">abrir asistente</a>.</p>`;
  }
  const anns = await api("announcements");
  return head + `<form data-form="ann" class="card"><h3>Publicar anuncio</h3><input name="title" placeholder="Título" required maxlength="200"><textarea name="body" class="mt" placeholder="Texto del anuncio"></textarea><label class="check"><input type="checkbox" name="pinned"> Fijar arriba</label><button class="btn sm">Publicar</button></form>
    ${anns.map(a => `<div class="card"><div class="row"><div class="grow">${a.pinned ? "📌 " : ""}<b>${esc(a.title)}</b><div class="mu sm">${fmtDT(a.created_at)}</div></div><button class="btn sm ghost" data-act="delann" data-id="${a.id}">Eliminar</button></div><div style="white-space:pre-wrap" class="sm mt">${esc(a.body)}</div></div>`).join("")}`;
};
FORM.ann = async (f, d) => { await api("announcements", { method: "POST", body: { title: d.title, body: d.body, pinned: !!d.pinned } }); toast("Anuncio publicado"); show("comunidad"); };
ACT.delann = async el => { if (!confirm("¿Eliminar el anuncio?")) return; await api("announcements/" + el.dataset.id, { method: "DELETE" }); show("comunidad"); };
FORM.rules = async f => {
  const fd = new FormData(f); const file = fd.get("file");
  if ((!file || !file.size) && !fd.get("text").trim()) throw new Error("Elija un archivo o pegue el texto");
  if (file && !file.size) fd.delete("file");
  toast("Procesando el documento…", false, 15000);
  const r = await api("admin/rules", { method: "POST", form: fd }); toast(`Reglamento cargado: ${r.chunks} fragmentos`); show("comunidad");
};
ACT.viewrule = async el => { const d = await api("admin/rules/" + el.dataset.id); modal(`<h2>${esc(d.title)}</h2><pre class="rules">${esc(d.text)}</pre><div class="btns"><button class="btn sec" data-act="close">Cerrar</button></div>`); };
ACT.delrule = async el => { if (!confirm("¿Eliminar este documento? El asistente dejará de usarlo.")) return; await api("admin/rules/" + el.dataset.id, { method: "DELETE" }); show("comunidad"); };

async function residenceView() {
  const r = await api("admin/residence");
  return `<form data-form="residence" class="card"><label>Nombre</label><input name="name" value="${esc(r.name)}" required>
    <label>Dirección</label><input name="address" value="${esc(r.address)}">
    <label>Zona horaria</label><input name="timezone" value="${esc(r.timezone)}">
    <label>Números para SMS de emergencia (separados por coma, formato +507…)</label><input name="emergency_numbers" value="${esc(r.emergency_numbers)}" placeholder="+50760000000, +50761111111">
    <p class="mu sm">Si el servidor tiene SMS configurado (Twilio), cada alerta de pánico también se envía por SMS a estos números.</p>
    <button class="btn sm">Guardar</button></form>`;
}
FORM.residence = async (f, d) => { await api("admin/residence", { method: "PUT", body: d }); S.res.name = d.name; S.res.timezone = d.timezone; toast("Guardado"); startApp(); };

// ---------------------------------------------------------------- SUPER ADMIN
VIEW.residencias = async () => {
  const rs = await api("admin/residences");
  return `<form data-form="newres" class="card"><h3>Nueva residencia</h3><label>Nombre</label><input name="name" required><label>Dirección</label><input name="address">
    <div class="grid2"><div><label>Nombre del administrador</label><input name="admin_name" required></div><div><label>Correo del administrador</label><input name="admin_email" type="email" required></div></div><button class="btn sm mt">Crear</button></form>
    <h2>${rs.length} residencia(s)</h2>${rs.map(r => `<div class="card"><b>${esc(r.name)}</b><div class="mu sm">${esc(r.address)} · ${r.units} unidades · admin: ${esc(r.admins.join(", "))}</div></div>`).join("")}`;
};
FORM.newres = async (f, d) => {
  const r = await api("admin/residences", { method: "POST", body: d });
  modal(`<h2>Residencia creada ✅</h2><p>Acceso del administrador:</p><div class="card"><b>${esc(r.admin_email)}</b><div class="code mt">${esc(r.temp_password)}</div></div><p class="mu sm">Contraseña temporal, se pedirá cambiarla al entrar.</p><div class="btns"><button class="btn sec" data-act="close">Listo</button></div>`);
  show("residencias");
};

document.addEventListener("visibilitychange", () => { if (!document.hidden && S.me && S.me.role !== "superadmin") { pollAlerts(); pollRequests(); } });
boot();
