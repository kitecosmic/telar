// Telar · credenciales — piezas compartidas (chips en la home, gestión en el taller).

import { api, aviso, esc } from "./comun.js";

export async function nombres() {
  const data = await api("/api/credenciales").catch(() => ({ items: [] }));
  return (data.items || []).map((c) => c.nombre).filter((n) => !n.startsWith("SYNSEMA_"));
}

// Fila con ✓ NOMBRE [editar] [borrar]
export function filaEditable(nombre, alCambiar) {
  const div = document.createElement("div");
  div.className = "cred";
  const modoVer = () => {
    div.innerHTML = `<span class="cred-ok">✓</span> <code>${esc(nombre)}</code>`;
    const be = document.createElement("button");
    be.className = "link-min"; be.type = "button"; be.textContent = "editar";
    be.onclick = modoEditar;
    const bb = document.createElement("button");
    bb.className = "link-min peligro"; bb.type = "button"; bb.textContent = "borrar";
    bb.onclick = async () => {
      if (!confirm(`¿Borrar la credencial ${nombre}? Los flujos que la usan van a fallar hasta que cargues otra.`)) return;
      try {
        await api("/api/credenciales/" + nombre, { method: "DELETE" });
        aviso(`🗑 ${nombre} borrada.`);
        alCambiar();
      } catch (err) { aviso("❌ " + err.message, true); }
    };
    div.append(" ", be, bb);
  };
  const modoEditar = () => {
    div.innerHTML = `<code>${esc(nombre)}</code>`;
    const inp = document.createElement("input");
    inp.type = "password"; inp.placeholder = "nuevo valor…";
    const ok = document.createElement("button");
    ok.className = "btn mini"; ok.type = "button"; ok.textContent = "Guardar";
    ok.onclick = async () => {
      if (!inp.value.trim()) return;
      try {
        await api("/api/credenciales", { method: "POST", body: JSON.stringify({ nombre, valor: inp.value }) });
        aviso(`🔑 ${nombre} actualizada.`);
        alCambiar();
      } catch (err) { aviso("❌ " + err.message, true); }
    };
    const cancel = document.createElement("button");
    cancel.className = "link-min"; cancel.type = "button"; cancel.textContent = "×";
    cancel.onclick = modoVer;
    div.append(" ", inp, ok, cancel);
    inp.focus();
  };
  modoVer();
  return div;
}

// Formulario de alta (NOMBRE_VAR + valor)
export function formAlta(alCambiar) {
  const form = document.createElement("form");
  form.className = "cred-alta";
  form.innerHTML = `
    <input class="campo-mono" name="nombre" placeholder="NOMBRE_VAR" autocomplete="off" spellcheck="false">
    <input class="campo-mono" name="valor" type="password" placeholder="valor" autocomplete="off">
    <button class="btn mini" type="submit">Guardar</button>`;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const nombre = form.nombre.value.trim().toUpperCase();
    const valor = form.valor.value;
    if (!nombre || !valor.trim()) return;
    try {
      await api("/api/credenciales", { method: "POST", body: JSON.stringify({ nombre, valor }) });
      aviso(`🔑 ${nombre} guardada — disponible para todos los flujos.`);
      form.reset();
      alCambiar();
    } catch (err) { aviso("❌ " + err.message, true); }
  });
  return form;
}
