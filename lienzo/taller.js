// Telar · taller — grafo, nodo (código/edición/chat), corridas y credenciales.

import { $, api, aviso, esc, iniciarTema, marcarNav, mostrarAvisoDiferido } from "./comun.js";
import { nombres, filaEditable, formAlta } from "./credenciales.js";

iniciarTema();
mostrarAvisoDiferido();

// el nav refleja dónde estás: sección credenciales o telares
function actualizarNav() {
  marcarNav(location.hash === "#credenciales" ? "creds" : "taller");
}
actualizarNav();

const state = { flujos: [], actual: null, nodo: null, timer: null };

// ── Lista de telares + buscador ─────────────────────
async function cargarFlujos(seleccionar) {
  const data = await api("/api/flujos").catch(() => ({ items: [] }));
  state.flujos = data.items || [];
  pintarLista();
  const hashId = (location.hash || "#").slice(1);
  const abrir = seleccionar || state.actual?.id || (hashId !== "credenciales" ? hashId : "") || state.flujos[0]?.id;
  if (abrir && state.flujos.some((f) => f.id === abrir)) abrirFlujo(abrir);
}

function pintarLista() {
  const filtro = $("buscador").value.trim().toLowerCase();
  const list = $("lista-flujos");
  list.innerHTML = "";
  for (const f of state.flujos) {
    if (filtro && !(f.nombre + " " + f.id).toLowerCase().includes(filtro)) continue;
    const b = document.createElement("button");
    b.className = "flujo-item" + (state.actual?.id === f.id ? " activo" : "");
    b.dataset.id = f.id;
    b.innerHTML = `${esc(f.nombre)}<span class="fid">${esc(f.id)} · ${f.nodos.length} nodos</span>`;
    b.onclick = () => abrirFlujo(f.id);
    list.appendChild(b);
  }
  if (!list.children.length) list.innerHTML = '<p class="mut chica">Nada con ese filtro.</p>';
}
$("buscador").addEventListener("input", pintarLista);

// ── Grafo ───────────────────────────────────────────
const NOMBRES_TIPO = { sql_query: "SQL", sql_exec: "SQL", http: "HTTP", llm_decide: "IA", condicion: "SI/NO", archivo: "ARCHIVO", custom: "SYNSEMA" };

function resumenNodo(n) {
  const c = n.config || {};
  if (c.query) return c.query;
  if (c.stmt) return c.stmt;
  if (c.url) return (c.metodo || "POST") + " " + c.url;
  if (c.op) return `${JSON.stringify(c.a)} ${c.op} ${JSON.stringify(c.b)}`;
  if (c.pregunta) return "→ " + (c.opciones || []).join(" | ");
  if (c.path) return c.path;
  if (c.codigo) return c.codigo[c.codigo.length - 1];
  return "";
}

function abrirFlujo(id) {
  const f = state.flujos.find((x) => x.id === id);
  if (!f) return;
  state.actual = f;
  if (location.hash !== "#credenciales") history.replaceState(null, "", "#" + id);
  document.querySelectorAll(".flujo-item").forEach((b) => b.classList.toggle("activo", b.dataset.id === id));
  $("grafo-vacio").hidden = true;
  $("d-snapshots").hidden = true;
  $("grafo").hidden = false;
  $("g-nombre").textContent = f.nombre;
  $("g-trigger").textContent =
    f.trigger.tipo === "cron" ? `⏰ cron · cada ${f.trigger.cada_segundos}s` : "⚡ " + f.trigger.tipo;
  const info = $("g-trigger-info");
  info.hidden = f.trigger.tipo !== "webhook";
  if (f.trigger.tipo === "webhook") {
    info.textContent = "📮 POST http://127.0.0.1:7002/wh/" + f.id + "  (gateway — guarda la entrega y encola)";
    if (f.trigger.agrupar) info.textContent += ` · 🫧 agrupa mensajes por remitente (${f.trigger.agrupar.silencio_segundos || 10}s de silencio)`;
  }

  // permisos (informativos; los reales los declara el .syn)
  const permisos = new Set(["db(./telar.db)"]);
  for (const n of f.nodos) {
    if (n.tipo === "http") try { permisos.add("net(" + new URL(n.config.url).hostname + ")"); } catch {}
    if (n.tipo === "llm_decide") permisos.add("llm");
    if (n.tipo === "archivo") permisos.add("file(" + n.config.path + ")");
    if (n.tipo === "custom") (n.config.requires || []).forEach((r) => permisos.add(r.replace("require ", "")));
  }
  $("g-permisos").innerHTML = [...permisos].map((p) => `<span class="permiso">${esc(p)}</span>`).join("");

  // el trigger encabeza el tejido
  const cont = $("g-nodos");
  cont.innerHTML = "";
  const trig = document.createElement("button");
  trig.className = "nodo trigger";
  trig.innerHTML =
    `<span class="chip">⚡ ${esc(f.trigger.tipo)}</span>` +
    `<span class="cuerpo"><span class="nid">trigger</span><span class="resumen">${esc(JSON.stringify(f.trigger.ejemplo || {}))}</span></span>`;
  trig.onclick = () => verNodo({ id: "trigger", tipo: f.trigger.tipo, config: f.trigger.ejemplo || {} });
  cont.appendChild(trig);
  f.nodos.forEach((n) => {
    const h = document.createElement("div");
    h.className = "hilo" + (n.solo_si ? " cond" : "");
    cont.appendChild(h);
    const card = document.createElement("button");
    card.className = "nodo";
    card.innerHTML =
      `<span class="chip">${esc(NOMBRES_TIPO[n.tipo] || n.tipo)}</span>` +
      `<span class="cuerpo"><span class="nid">${esc(n.id)}</span><span class="resumen">${esc(resumenNodo(n))}</span></span>` +
      (n.solo_si ? `<span class="cond-tag">solo si ${esc(n.solo_si)}</span>` : "");
    card.onclick = () => verNodo(n);
    cont.appendChild(card);
  });

  renderCredsFlujo(f);
  $("d-probar").hidden = false;
  $("d-nodo").hidden = true;
  $("probar-out").hidden = true;
  $("f-respuesta").hidden = true;
  $("f-chat").value = "";
  $("probar-input").value = JSON.stringify(f.trigger.ejemplo || {}, null, 2);
  cargarRuns();
  cargarVersiones();
  clearInterval(state.timer);
  state.timer = setInterval(cargarRuns, 3000);
}

// ── Charla del telar: preguntar o pedir cambio ──────
$("f-preguntar").addEventListener("click", async () => {
  const pregunta = $("f-chat").value.trim();
  if (!pregunta || !state.actual) return;
  const btn = $("f-preguntar");
  btn.disabled = true; btn.textContent = "Pensando…";
  try {
    const r = await api(`/api/flujos/${state.actual.id}/consultar`, { method: "POST", body: JSON.stringify({ pregunta }) });
    const out = $("f-respuesta");
    out.hidden = false;
    out.textContent = r.respuesta || "(sin respuesta)";
  } catch (err) { aviso("❌ " + err.message, true); }
  btn.disabled = false; btn.textContent = "💬 Preguntar";
});

$("f-pedir").addEventListener("click", () => pedirFlujo(false));

async function pedirFlujo(forzar) {
  const pedidoTxt = $("f-chat").value.trim();
  if (!pedidoTxt || !state.actual) return;
  const btn = $("f-pedir");
  btn.disabled = true; btn.textContent = "Tejiendo…";
  try {
    const r = await api(`/api/flujos/${state.actual.id}/pedir`, { method: "POST", body: JSON.stringify({ pedido: pedidoTxt, forzar }) });
    if (r.ok) {
      let msg = `✂️ Telar editado (la versión anterior quedó guardada)`;
      if (r.probado) msg += " y probado ✓";
      else if (r.faltan_credenciales?.length) msg += `. Faltan credenciales: ${r.faltan_credenciales.join(", ")}`;
      else if (r.advertencia) msg += `. ⚠️ ${r.advertencia}`;
      aviso(msg);
      $("f-chat").value = "";
      $("d-nodo").hidden = true;
      await cargarFlujos(state.actual.id);
    } else {
      aviso("❌ " + (r.error || "no se pudo") + (r.nota ? " — " + r.nota : ""), true);
    }
  } catch (err) {
    btn.disabled = false; btn.textContent = "✂️ Pedir cambio";
    if (err.message.includes("parece una credencial")) {
      if (confirm(err.message + "\n\n¿Es un falso positivo? Aceptar = enviar igual.")) return pedirFlujo(true);
      return;
    }
    aviso("❌ " + err.message, true);
    return;
  }
  btn.disabled = false; btn.textContent = "✂️ Pedir cambio";
}

// ── Borrar telar (suave: queda en versiones) ────────
$("g-borrar").addEventListener("click", async () => {
  if (!state.actual) return;
  if (!confirm(`¿Borrar el telar "${state.actual.nombre}"? Queda archivado y recuperable desde versiones.`)) return;
  try {
    await api("/api/flujos/" + state.actual.id, { method: "DELETE" });
    aviso(`🗑 Telar ${state.actual.id} borrado.`);
    state.actual = null;
    history.replaceState(null, "", " ");
    $("grafo").hidden = true;
    $("grafo-vacio").hidden = false;
    $("d-probar").hidden = true;
    $("d-nodo").hidden = true;
    $("d-creds-flujo").hidden = true;
    $("d-versiones").hidden = true;
    await cargarFlujos();
  } catch (err) { aviso("❌ " + err.message, true); }
});

// ── Versiones ───────────────────────────────────────
async function cargarVersiones() {
  if (!state.actual) return;
  const data = await api(`/api/flujos/${state.actual.id}/versiones`).catch(() => null);
  const vs = data?.items || [];
  $("d-versiones").hidden = vs.length === 0;
  const cont = $("lista-versiones");
  cont.innerHTML = "";
  for (const v of vs) {
    const div = document.createElement("div");
    div.className = "version-item";
    div.innerHTML = `<span class="mono">${new Date(v.created * 1000).toLocaleTimeString("es-AR")}</span><span class="motivo" title="${esc(v.motivo)}">${esc(v.motivo)}</span>`;
    const btn = document.createElement("button");
    btn.className = "link-min"; btn.type = "button"; btn.textContent = "restaurar";
    btn.onclick = async () => {
      if (!confirm("¿Restaurar esta versión? La actual queda guardada en el historial.")) return;
      try {
        await api(`/api/flujos/${state.actual.id}/restaurar/${v.vid}`, { method: "POST" });
        aviso("⏪ Versión restaurada.");
        $("d-nodo").hidden = true;
        await cargarFlujos(state.actual.id);
      } catch (err) { aviso("❌ " + err.message, true); }
    };
    div.appendChild(btn);
    cont.appendChild(div);
  }
}

// ── Credenciales ────────────────────────────────────
function secretosDe(v, acc = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => secretosDe(x, acc));
  else if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      if ((k === "secret" || k === "bearer") && typeof val === "string") acc.add(val);
      else secretosDe(val, acc);
    }
  }
  return acc;
}

async function renderCredsFlujo(flujo) {
  const secs = [...secretosDe(flujo.nodos)];
  const panel = $("d-creds-flujo");
  panel.hidden = secs.length === 0;
  if (!secs.length) return;
  const guardadas = new Set(await nombres());
  const cont = $("lista-creds");
  cont.innerHTML = "";
  const refrescar = () => { cargarCredsGlobal(); renderCredsFlujo(flujo); };
  for (const s of secs) {
    if (guardadas.has(s)) { cont.appendChild(filaEditable(s, refrescar)); continue; }
    const row = document.createElement("div");
    row.className = "cred";
    row.innerHTML = `<code>${esc(s)}</code>`;
    const inp = document.createElement("input");
    inp.type = "password";
    inp.placeholder = "pegá el valor…";
    const btn = document.createElement("button");
    btn.className = "btn mini"; btn.type = "button"; btn.textContent = "Guardar";
    btn.onclick = async () => {
      if (!inp.value.trim()) return;
      try {
        await api("/api/credenciales", { method: "POST", body: JSON.stringify({ nombre: s, valor: inp.value }) });
        aviso(`🔑 ${s} guardada — ya podés correr el flujo.`);
        refrescar();
      } catch (err) { aviso("❌ " + err.message, true); }
    };
    row.append(" ", inp, btn);
    cont.appendChild(row);
  }
}

async function cargarCredsGlobal() {
  const ns = await nombres();
  const cont = $("creds-lista");
  cont.innerHTML = ns.length ? "" : '<p class="mut chica">Ninguna todavía.</p>';
  const refrescar = () => { cargarCredsGlobal(); if (state.actual) renderCredsFlujo(state.actual); };
  for (const n of ns) cont.appendChild(filaEditable(n, refrescar));
}
$("creds-form").appendChild(formAlta(() => cargarCredsGlobal()));
cargarCredsGlobal();

// ── Nodo: código, edición manual y chat ─────────────
async function verNodo(n) {
  state.nodo = n.id;
  const esTrigger = n.id === "trigger";
  $("d-nodo").hidden = false;
  $("n-id").textContent = n.id + " (" + n.tipo + ")";
  $("n-config").value = JSON.stringify(n.config, null, 2);
  $("n-guardar").hidden = esTrigger;
  $("n-chat").parentElement.hidden = esTrigger;
  $("n-ensayo").hidden = esTrigger;
  $("e-out").hidden = true;
  if (!esTrigger) prefillCtx(n);
  $("n-fuente").textContent = "…";
  try {
    const res = await fetch(`/api/flujos/${state.actual.id}/fuente`);
    const src = await res.text();
    $("n-fuente").textContent = seccionFuente(src, n.id, esTrigger);
  } catch { $("n-fuente").textContent = "(no disponible)"; }
}

// Entrada del ensayo: el ctx del nodo ANTERIOR en la última corrida;
// si no hay corridas, el ejemplo del trigger.
async function prefillCtx(n) {
  const f = state.actual;
  let ctx = { trigger: f.trigger.ejemplo || {} };
  try {
    const runs = ((await api("/api/runs")).items || []).filter((r) => r.flujo === f.id);
    if (runs.length) {
      const snaps = (await api(`/api/runs/${runs[0].id}/snapshots`)).items || [];
      const idx = f.nodos.findIndex((x) => x.id === n.id);
      const previo = idx > 0 ? snaps.find((s) => s.nodo === f.nodos[idx - 1].id) : null;
      if (previo) ctx = JSON.parse(previo.ctx);
      else if (snaps.length) ctx = { trigger: JSON.parse(snaps[0].ctx).trigger || {} };
    }
  } catch {}
  $("e-ctx").value = JSON.stringify(ctx, null, 2);
}

async function ensayar(modo) {
  if (!state.actual || !state.nodo) return;
  let ctx;
  try { ctx = JSON.parse($("e-ctx").value); }
  catch { return aviso("❌ El ctx no es JSON válido.", true); }
  if (modo === "real" && !confirm("⚡ Ejecutar REAL: el nodo va a tener efectos de verdad (insertar filas, llamar la API, escribir el archivo). ¿Seguro?")) return;
  const btn = $(modo === "real" ? "e-real" : "e-ensayar");
  btn.disabled = true;
  try {
    const r = await api(`/api/flujos/${state.actual.id}/nodos/${state.nodo}/ensayar`, { method: "POST", body: JSON.stringify({ ctx, modo }) });
    const out = $("e-out");
    out.hidden = false;
    out.textContent = JSON.stringify(r, null, 2);
  } catch (err) { aviso("❌ " + err.message, true); }
  btn.disabled = false;
}
$("e-ensayar").addEventListener("click", () => ensayar("ensayo"));
$("e-real").addEventListener("click", () => ensayar("real"));

function seccionFuente(src, nid, esTrigger) {
  const lineas = src.split("\n");
  if (esTrigger) return lineas.filter((l) => l.includes('ctx["trigger"]')).join("\n") || "(trigger)";
  const partes = [];
  let i = lineas.findIndex((l) => l.startsWith(`task nodo_custom_${nid}(`));
  if (i >= 0) { while (i < lineas.length && lineas[i].trim() !== "") partes.push(lineas[i++]); partes.push(""); }
  i = lineas.findIndex((l) => l.startsWith(`-- nodo ${nid} (`));
  if (i >= 0) { while (i < lineas.length && lineas[i].trim() !== "") partes.push(lineas[i++]); }
  return partes.join("\n") || "(no encontrado en el .syn)";
}

async function recargarYReabrir(nid) {
  await cargarFlujos(state.actual.id);
  const n = state.actual?.nodos.find((x) => x.id === nid);
  if (n) verNodo(n);
}

$("n-guardar").addEventListener("click", async () => {
  if (!state.actual || !state.nodo) return;
  let cfg;
  try { cfg = JSON.parse($("n-config").value); }
  catch { return aviso("❌ Ese JSON no es válido — revisá comas y comillas.", true); }
  const btn = $("n-guardar");
  btn.disabled = true;
  try {
    await api(`/api/flujos/${state.actual.id}/nodos/${state.nodo}`, { method: "POST", body: JSON.stringify({ config: cfg }) });
    aviso(`✏️ Nodo ${state.nodo} guardado y recompilado.`);
    await recargarYReabrir(state.nodo);
  } catch (err) { aviso("❌ " + err.message, true); }
  btn.disabled = false;
});

$("n-pedir").addEventListener("click", () => pedirNodo(false));

async function pedirNodo(forzar) {
  if (!state.actual || !state.nodo) return;
  const pedidoTxt = $("n-chat").value.trim();
  if (!pedidoTxt) return;
  const btn = $("n-pedir");
  btn.disabled = true;
  btn.textContent = "Tejiendo…";
  try {
    const r = await api(`/api/flujos/${state.actual.id}/nodos/${state.nodo}/pedir`, { method: "POST", body: JSON.stringify({ pedido: pedidoTxt, forzar }) });
    if (r.ok) {
      let msg = `✂️ Nodo ${state.nodo} editado`;
      if (r.probado) msg += " y probado ✓";
      else if (r.faltan_credenciales?.length) msg += `. Faltan credenciales: ${r.faltan_credenciales.join(", ")}`;
      else if (r.advertencia) msg += `. ⚠️ ${r.advertencia}`;
      aviso(msg);
      $("n-chat").value = "";
      await recargarYReabrir(state.nodo);
    } else {
      aviso("❌ " + (r.error || "no se pudo") + (r.nota ? " — " + r.nota : ""), true);
    }
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "Pedir cambio ✂️";
    if (err.message.includes("parece una credencial")) {
      if (confirm(err.message + "\n\n¿Es un falso positivo? Aceptar = enviar igual.")) return pedirNodo(true);
      return;
    }
    aviso("❌ " + err.message, true);
    return;
  }
  btn.disabled = false;
  btn.textContent = "Pedir cambio ✂️";
}

// ── Probar flujo ────────────────────────────────────
$("probar-btn").addEventListener("click", async () => {
  if (!state.actual) return;
  const btn = $("probar-btn");
  btn.disabled = true;
  try {
    const r = await api("/api/correr/" + state.actual.id, { method: "POST", body: $("probar-input").value });
    const out = $("probar-out");
    out.hidden = false;
    out.textContent = (r.exit === 0 ? "" : "exit " + r.exit + "\n") + (r.stdout || "") + (r.stderr || "");
    cargarRuns();
  } catch (err) { aviso("❌ " + err.message, true); }
  btn.disabled = false;
});

// ── Corridas y snapshots ────────────────────────────
async function cargarRuns() {
  if (!state.actual) return;
  const data = await api("/api/runs").catch(() => null);
  if (!data) return;
  const runs = (data.items || []).filter((r) => r.flujo === state.actual.id);
  const list = $("lista-runs");
  list.innerHTML = runs.length ? "" : '<p class="mut chica">Sin corridas todavía.</p>';
  for (const r of runs) {
    const b = document.createElement("button");
    b.className = "run-item";
    const est = r.estado === "ok" ? '<span class="ok">ok</span>' : `<span class="otro">${esc(r.estado)}</span>`;
    b.innerHTML = `${est} · ${esc(r.id)} · ${new Date(r.created * 1000).toLocaleTimeString("es-AR")}`;
    b.onclick = () => verSnapshots(r.id);
    list.appendChild(b);
  }
}

async function verSnapshots(rid) {
  const data = await api(`/api/runs/${rid}/snapshots`).catch(() => null);
  if (!data) return;
  $("d-snapshots").hidden = false;
  $("s-run").textContent = rid;
  const cont = $("lista-snaps");
  cont.innerHTML = "";
  for (const s of data.items || []) {
    const div = document.createElement("div");
    div.className = "snap";
    let ctx = s.ctx;
    try { ctx = JSON.stringify(JSON.parse(s.ctx), null, 2); } catch {}
    div.innerHTML = `<div class="snid">⦿ ${esc(s.nodo)}</div>`;
    const pre = document.createElement("pre");
    pre.className = "salida";
    pre.textContent = ctx;
    div.appendChild(pre);
    cont.appendChild(div);
  }
}

// ── Arranque ────────────────────────────────────────
window.addEventListener("hashchange", () => {
  actualizarNav();
  const id = location.hash.slice(1);
  if (location.hash === "#credenciales") {
    $("credenciales").scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (id && id !== state.actual?.id) cargarFlujos(id);
});
if (location.hash === "#credenciales") setTimeout(() => $("credenciales").scrollIntoView(), 300);
cargarFlujos();
