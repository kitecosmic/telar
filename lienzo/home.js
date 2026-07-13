// Telar · home — el chat de creación.

import { $, api, aviso, avisoDiferido, esc, iniciarTema, marcarNav } from "./comun.js";
import { nombres, formAlta } from "./credenciales.js";

iniciarTema();
marcarNav("home");

// saludo según la hora
const h = new Date().getHours();
$("saludo").textContent = h < 12 ? "Buen día 👋" : h < 19 ? "Buenas tardes 👋" : "Buenas noches 👋";

// ── Composer: botón solo con texto, Enter envía ─────
const pedido = $("pedido");
const enviar = $("enviar");

function ajustar() {
  pedido.style.height = "auto";
  pedido.style.height = Math.min(pedido.scrollHeight, 320) + "px";
  enviar.hidden = pedido.value.trim() === "";
}
pedido.addEventListener("input", ajustar);
pedido.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    if (pedido.value.trim()) tejer();
  }
});
enviar.addEventListener("click", tejer);
pedido.focus();

async function tejer(forzar = false) {
  const texto = pedido.value.trim();
  if (!texto) return;
  enviar.disabled = true;
  pedido.disabled = true;
  $("tejiendo").hidden = false;
  try {
    const r = await api("/api/pedir", {
      method: "POST",
      body: JSON.stringify({ pedido: texto, contexto: $("ctx-auto").checked, forzar }),
    });
    if (r.ok) {
      let msg = `✅ Flujo "${r.id}" construido${r.probado ? " y probado con su ejemplo" : ""}.`;
      if (r.faltan_credenciales?.length) msg = `🔑 Flujo "${r.id}" construido. Cargá: ${r.faltan_credenciales.join(", ")} y probalo.`;
      avisoDiferido(msg);
      location.href = "/taller#" + r.id;
      return;
    }
    aviso("❌ El builder no logró un flujo que compile: " + (r.error || ""), true);
  } catch (err) {
    enviar.disabled = false;
    pedido.disabled = false;
    $("tejiendo").hidden = true;
    if (err.message.includes("parece una credencial")) {
      if (confirm(err.message + "\n\n¿Es un falso positivo? Aceptar = enviar igual.")) return tejer(true);
      aviso("Pedido no enviado — cargá la credencial en el panel y nombrala en el pedido.", true);
      return;
    }
    if (err.message.includes("builder no disponible")) {
      aviso("⏳ El builder tardó más de la cuenta. Puede que siga tejiendo en segundo plano — mirá 'Telares' en un minuto.", true);
      return;
    }
    aviso("❌ " + err.message, true);
    return;
  }
  enviar.disabled = false;
  pedido.disabled = false;
  $("tejiendo").hidden = true;
}

// ── Credenciales como chips ─────────────────────────
async function cargarChips() {
  const ns = await nombres();
  $("creds-chips").innerHTML = ns.length
    ? ns.map((n) => `<span class="chip">✓ ${esc(n)}</span>`).join("")
    : '<span class="mut chica">Ninguna todavía — cargá la primera con “+ nueva”.</span>';
}
$("creds-alta").appendChild(formAlta(() => { cargarChips(); $("creds-alta").hidden = true; }));
$("cred-nueva").addEventListener("click", () => {
  const alta = $("creds-alta");
  alta.hidden = !alta.hidden;
  if (!alta.hidden) alta.querySelector("input").focus();
});
cargarChips();

// ── Telares recientes (los últimos usados + ver todos) ──
(async () => {
  const [fl, rn] = await Promise.all([
    api("/api/flujos").catch(() => ({ items: [] })),
    api("/api/runs").catch(() => ({ items: [] })),
  ]);
  const flujos = fl.items || [];
  // /api/runs viene ordenado desc → la primera aparición es la última corrida
  const ultimo = {};
  for (const r of rn.items || []) if (!(r.flujo in ultimo)) ultimo[r.flujo] = r.created;
  flujos.sort((a, b) => (ultimo[b.id] || 0) - (ultimo[a.id] || 0));
  // una sola fila: 2 recientes + "ver todos" — la home no scrollea
  const top = flujos.slice(0, 2);
  let html = top.map((f) => `
    <a class="telar-card carta" href="/taller#${esc(f.id)}">
      <div class="nombre">${esc(f.nombre)}</div>
      <div class="meta">${esc(f.id)} · ${f.nodos.length} nodos · ⚡${esc(f.trigger.tipo)}</div>
    </a>`).join("");
  if (flujos.length > top.length) {
    html += `<a class="telar-card carta ver-todos" href="/taller"><span>Ver todos (${flujos.length}) →</span></a>`;
  }
  $("recientes").innerHTML = html || '<p class="mut">Todavía no hay telares — pedí el primero acá arriba.</p>';
})();
