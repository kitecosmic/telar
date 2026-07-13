// Telar · comun — helpers compartidos por todas las páginas.

export const $ = (id) => document.getElementById(id);

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "error " + res.status);
  return data;
}

export function esc(t) {
  const d = document.createElement("span");
  d.textContent = String(t);
  return d.innerHTML;
}

let avisoTimer;
export function aviso(msg, esError = false) {
  let el = document.getElementById("aviso");
  if (!el) {
    el = document.createElement("div");
    el.id = "aviso";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = "aviso" + (esError ? " error" : "");
  el.hidden = false;
  clearTimeout(avisoTimer);
  avisoTimer = setTimeout(() => (el.hidden = true), 9000);
}

// Mensaje diferido entre páginas (ej: "flujo construido" tras redirigir al taller).
export function avisoDiferido(msg) { sessionStorage.setItem("telar-aviso", msg); }
export function mostrarAvisoDiferido() {
  const m = sessionStorage.getItem("telar-aviso");
  if (m) { sessionStorage.removeItem("telar-aviso"); aviso(m); }
}

// ── Tema claro/oscuro ────────────────────────────────
function temaActual() {
  return localStorage.getItem("telar-tema") ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro");
}

function aplicarTema(t) {
  document.documentElement.dataset.tema = t;
  const btn = document.getElementById("tema-toggle");
  if (btn) btn.textContent = t === "oscuro" ? "☀ Tema claro" : "🌙 Tema oscuro";
}

export function iniciarTema() {
  aplicarTema(temaActual());
  const btn = document.getElementById("tema-toggle");
  if (btn) btn.addEventListener("click", () => {
    const nuevo = document.documentElement.dataset.tema === "oscuro" ? "claro" : "oscuro";
    localStorage.setItem("telar-tema", nuevo);
    aplicarTema(nuevo);
  });
}

export function marcarNav(pag) {
  document.querySelectorAll(".nav-item[data-pag]").forEach((a) =>
    a.classList.toggle("activo", a.dataset.pag === pag)
  );
}
