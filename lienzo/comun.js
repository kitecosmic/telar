// Telar · comun — helpers compartidos por todas las páginas.

export const $ = (id) => document.getElementById(id);

// ── Sesión (login opcional: TELAR_USUARIO/TELAR_CLAVE en el .env) ──
const token = () => localStorage.getItem("telar-token") || "";

export async function api(path, opts = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token()) headers["Authorization"] = "Bearer " + token();
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers,
    body: opts.body,
  });
  if (res.status === 401 && path !== "/api/login") {
    mostrarLogin();
    throw new Error("sesión requerida");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || "error " + res.status);
  return data;
}

function mostrarLogin() {
  if (document.getElementById("login-velo")) return;
  const velo = document.createElement("div");
  velo.id = "login-velo";
  velo.innerHTML = `
    <form id="login-card" autocomplete="on">
      <h2>Telar</h2>
      <p>Ingresá para entrar a tu taller.</p>
      <label>Usuario<input id="login-usuario" autocomplete="username" required></label>
      <label>Clave<input id="login-clave" type="password" autocomplete="current-password" required></label>
      <p id="login-error" hidden></p>
      <button type="submit">Entrar</button>
    </form>`;
  document.body.appendChild(velo);
  const err = velo.querySelector("#login-error");
  velo.querySelector("#login-card").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    try {
      const r = await api("/api/login", {
        method: "POST",
        body: JSON.stringify({
          usuario: velo.querySelector("#login-usuario").value,
          clave: velo.querySelector("#login-clave").value,
        }),
      });
      localStorage.setItem("telar-token", r.token);
      location.reload();
    } catch (e) {
      err.textContent = "Usuario o clave incorrectos.";
      err.hidden = false;
    }
  });
  velo.querySelector("#login-usuario").focus();
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
