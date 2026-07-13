# Telar — automatizaciones que se piden, no se arman

> *Manifiesto y diseño técnico. Nombre provisorio: un telar teje hilos (nodos) en tela (flujos).*

Telar es una plataforma de automatización estilo n8n/Make/Typebot con una diferencia
de fondo: **el flujo no lo armás vos arrastrando nodos — se lo pedís a la IA**, y lo
que la IA produce no es un JSON opaco de plataforma sino **un programa Synsema
legible, testeado y con permisos imposibles de violar**.

```
"Quiero que cuando llegue un pedido a Vereda se guarde en la base,
 me pida aprobación si supera $50.000 y le avise al cliente."
                      ↓
     [webhook-in] → [guardar SQL] → [¿> 50k?] → [aprobación humana] → [responder chat]
                      ↓
              flujo.syn  ·  5 tests pasando  ·  permisos: db(./pedidos.db), net(127.0.0.1)
```

---

## Arrancar el MVP

```
1. Requisitos: binario `synsema` en el PATH (v0.4.6+).
2. cp .env.example .env   → completá tu key de LLM (MiniMax/Anthropic/OpenAI/DeepSeek).
3. synsema run setup.syn  → crea telar.db (una sola vez).
4. Doble clic en iniciar.bat  (o a mano: 3 × `synsema serve` + `synsema run worker.syn`)
5. Abrí http://127.0.0.1:7000 y pedí tu primera automatización.
```

| Servicio | Puerto | Rol |
|---|---|---|
| lienzo  | :7000 | UI (home + taller) y API de flujos/credenciales/corridas |
| builder | :7001 | el LLM que teje, edita, consulta y prueba flujos |
| gateway | :7002 | webhooks públicos `POST /wh/<flujo>` + firma HMAC + replay |
| worker  | —     | ejecuta la cola y dispara los triggers cron |

**Login (opcional, recomendado fuera de tu PC)** — dos variables en el `.env`:
```
TELAR_USUARIO=admin
TELAR_CLAVE=una-clave-larga-y-dificil-de-adivinar
```
Con eso la UI pide usuario y clave (sesión de 12 h con token firmado
HMAC-SHA256 — la clave nunca viaja), toda la API del lienzo exige sesión, y en el
gateway también `/entregas` y `/reenviar`. Los webhooks `/wh/*` siguen públicos:
su protección es por flujo (abajo). Sin las variables, Telar corre abierto (modo
local). Si exponés Telar a internet: publicá SOLO :7000 y :7002 — el builder
(:7001) y el worker son internos.

**Protección de webhooks — opcional y por flujo** (un webhook simple no lleva ninguna
y entra directo). Tres niveles, según lo que use el emisor:
- `"firma": {"header": "X-Hub-Signature-256", "secreto": "VAR", "prefijo": "sha256="}` —
  HMAC sobre el body crudo (GitHub/Stripe/Meta/Shopify), tiempo constante, verificado
  ANTES de encolar.
- `"header_secreto": {"header": "X-Telegram-Bot-Api-Secret-Token", "secreto": "VAR"}` —
  token simple en header (Telegram), comparación en tiempo constante.
- `"verificacion": {"secreto": "VAR"}` — handshake de alta de Meta/WhatsApp Cloud API:
  el `GET /wh/<flujo>?hub.verify_token=…&hub.challenge=…` devuelve el challenge si el
  token coincide.
Para recibir de servicios externos reales (Telegram/Meta) el gateway necesita URL
pública: un túnel (cloudflared/ngrok) en dev, o deploy con `--tls-auto` en un VPS.

**Debounce de grupo (mensajería)** — para WhatsApp/Telegram/chat donde la gente manda
"hola" / "tengo una duda" / "¿el precio?" en ráfaga: el trigger declara
`"agrupar": {"por": {"ref": "trigger.<id del remitente>"}, "silencio_segundos": 10}`.
Las entregas de un mismo remitente quedan `esperando` en la cola; cuando pasa el
silencio sin mensajes nuevos, el worker las une y corre **una sola vez** con
`{"mensajes": [payloads en orden], "grupo": remitente}`. Cada remitente es un grupo
independiente. El builder ya lo genera si le contás que es un canal de mensajes.

## Conectar tu bot de Telegram (4 pasos)

La cañería está probada de punta a punta (secret de header + debounce de ráfagas +
memoria + respuesta con IA + envío por la API). Los pasos:

1. **Crear el bot**: hablale a `@BotFather` en Telegram → `/newbot` → copiá el token.
2. **Tejer el flujo**: pedíselo al builder desde el home, por ejemplo: *"un bot de
   Telegram con IA: agrupa mensajes seguidos, recuerda la conversación y responde
   por la API de Telegram usando TELEGRAM_BOT_TOKEN; webhook protegido con
   TELEGRAM_WH_SECRET"*. Anotá el id que le puso (ej. `telegram_bot`).
3. **Cargar credenciales en el panel** (Inicio → Credenciales — nunca por chat):
   `TELEGRAM_BOT_TOKEN` (el de BotFather) y `TELEGRAM_WH_SECRET` (inventalo vos:
   random y largo).
4. **Registrar el webhook** — Telegram necesita una URL pública que llegue a tu
   gateway (:7002). Según tu caso:

   *Con dominio propio* (producción — lo normal si Telar corre en un servidor):
   apuntá el dominio al gateway (reverse proxy o `--tls-auto`) y registrá **una
   sola vez** — queda registrado aunque reinicies Telar:
   ```
   URL_PUBLICA=https://telar.tudominio.com synsema run conectar_telegram.syn
   ```

   *Sin dominio* (desarrollo en tu PC): un túnel efímero hace de URL pública.
   Ojo: el túnel quick cambia de URL en cada arranque → re-corré el registro
   con la URL nueva cada vez:
   ```
   cloudflared tunnel --url http://127.0.0.1:7002
   URL_PUBLICA=https://<lo-que-te-dio>.trycloudflare.com synsema run conectar_telegram.syn
   ```

   El script llama a `setWebhook` con tu secret y te muestra el estado según Telegram.
   Si tu flujo no se llama `telegram_bot`, agregá `TELEGRAM_FLUJO=<id_de_tu_flujo>`.

Escribile 2-3 mensajes seguidos al bot → **una** respuesta con todo el contexto.

**Memoria entre visitas** — que el bot retome la charla aunque pasen horas: el trigger
declara `"memoria": {"ventana": 16, "texto_en": "message.text", "respuesta_de": "pensar"}`.
El worker inyecta `trigger.historial` (últimos N turnos de ESE chat, tabla `charlas`,
clave flujo+grupo) antes de correr, guarda los mensajes entrantes al agrupar, y tras una
corrida ok guarda la salida del nodo `respuesta_de` (la saca de los snapshots) como turno
del bot. Si la corrida falla, la entrada igual queda registrada. El nodo que piensa debe
incluir `trigger.historial` en su prompt (el builder ya lo sabe). Verificado: "soy juan,
quiero cemento, después confirmo" → (visita nueva) "confirmo: 5 bolsas" → el bot reservó
"las 5 bolsas de cemento" recordando nombre y pedido.
Peculiaridad de Telegram: el token viaja en la URL (diseño de ellos), por eso el nodo
`enviar` usa `env("TELEGRAM_BOT_TOKEN")` en un custom en vez de un header con secret.

## El manifiesto (los 6 principios)

**1. El flujo es código; el lienzo es una vista.**
n8n guarda tus flujos como un grafo JSON que solo su runtime entiende. En Telar la
fuente de verdad es un `.syn`: legible, diffeable, versionable en git, ejecutable con
un binario único. El lienzo se *deriva* del código (auto-layout), nunca al revés.
Si un día te vas de Telar, te llevás programas que corren solos. **Cero lock-in.**

**2. La IA propone; las capabilities disponen.**
Synsema es deny-by-default: si el flujo no declara `require net("api.stripe.com")`,
esa llamada es *imposible a nivel intérprete*, no "desaconsejada". Cuando el builder
te muestra un flujo nuevo, te muestra también su superficie exacta de permisos —
"este flujo puede tocar: tu SQLite, api.stripe.com, el LLM" — y **vos aprobás
capacidades, no promesas**. Un LLM generando código que se ejecuta necesita
exactamente esta red de seguridad.

**3. Ningún nodo existe sin haber pasado sus tests.**
El ciclo del builder es: generar nodo → `synsema check` (¿parsea?) → `synsema test`
(bloques `test` con entradas grabadas) → recién ahí aparece en el lienzo. Si el agente
no logra hacer pasar los tests, te lo dice — no te entrega un flujo roto.

**4. El estado es explícito y queda grabado.**
La salida de cada nodo vive en un map `ctx` que se enhebra por todo el flujo
(ver *Arquitectura*), y después de cada nodo se persiste un snapshot en SQLite.
Eso regala tres features que en otras plataformas son producto premium:
- **Historial de ejecuciones**: qué entró y salió de cada nodo, en cada corrida.
- **Probar un nodo suelto**: re-ejecutar el nodo 4 con su entrada grabada, sin correr los anteriores.
- **Reanudar**: un flujo caído retoma desde el último nodo exitoso.

**5. Degradación honesta.**
Si lo que pedís necesita algo que no está (una API key, una capability, un servicio
caído), el agente lo dice y propone el camino: *"puedo armarlo, pero necesito
`net('api.mercadopago.com')` y tu key — ¿la cargo en el .env?"*. Nunca finge.
(Es el mismo patrón que ya probamos: el bot de la pizzería funciona con reglas si
el LLM está offline, y lo avisa.)

**6. Humanos en el circuito, como primitiva.**
"Pedime aprobación antes de X" no es una integración con Slack: es `approve`/`confirm`
del lenguaje, con timeout fail-closed (si nadie aprueba, se deniega) y webhook saliente
para avisarte por donde quieras.

---

## Arquitectura: servicios chicos, carpetas separadas

Cuatro servicios diminutos + los flujos como **artefactos** (no servicios). Se
comunican por una SQLite compartida (cola + memoria) y webhooks internos — el
patrón ya probado en Vereda, con la cola en el medio. Cada servicio tiene su
carpeta, su `.env` y sus capabilities mínimas: nada de archivos gigantes ni
código mezclado.

```
telar/
├── lienzo/    UI: grafo read-only + chat + historial en vivo (SSE)   :7000
├── builder/   el cerebro LLM (tool-use) — edita flujos/, corre tests :7001
├── gateway/   TODOS los webhooks entrantes  /wh/:flow/:trigger       :7002 (público)
├── worker/    saca corridas de la cola y ejecuta `synsema run`       (sin puerto público)
├── flujos/    los .syn compilados + catálogo de nodos (módulos)
└── telar.db   flows · runs · snapshots · deliveries (cola compartida)
```

```
 webhook externo ──► GATEWAY ──encola──► telar.db ◄──consume── WORKER ──run──► flujos/pedido.syn
                        │ guarda entrega                │ snapshots por nodo         (proceso efímero)
 usuario ──chat──► LIENZO ◄──SSE (corridas en vivo)─────┘
                        │ pedidos
                        ▼
                    BUILDER ──escribe/testea──► flujos/
```

### Gateway — la superficie pública estable
Un solo servicio dueño de todas las URLs de webhook (`/wh/:flow_id/:trigger_id`).
**Nunca se reinicia cuando un flujo cambia** → las URLs sobreviven recompilaciones.
Guarda las últimas N entregas por endpoint (`deliveries`) → **webhook de prueba**:
re-enviar una entrega real grabada, o inyectar una sintética desde el lienzo (el
modo test de n8n, gratis). Varios webhooks por flujo = varias filas, no varios
puertos. Capabilities: `serve` + `db` — no puede ejecutar procesos ni salir a la red.

### Worker — el único que ejecuta
Consume la cola (`runs` pendientes) y lanza cada corrida como **proceso efímero**:
`synsema run flujos/<flow>.syn` (capability `exec`). Consecuencias buenas:
- Los flujos compilados **no llevan bloque `serve`**: son programas lineales puros
  que leen su input (el payload del trigger) de la base y mueren. El compilador de
  la fase 1 se simplifica.
- Aislamiento real por corrida: timeout y kill por proceso, un flujo colgado no
  toca a los demás. Reintentos y límite de concurrencia viven en un solo lugar.
- Un flujo con nodo `approve` queda en pausa persistida (snapshot) y el worker lo
  retoma cuando llega la aprobación.

### El Builder (el cerebro, fuera de Synsema)
Un modelo fuerte con tool-use (el provider que configures en `.env`) con herramientas tipo:
`propose_graph`, `write_node`, `check`, `test_node(input_grabado)`, `compile_flow`,
`run_flow`, `ask_user(capability|credencial)`. Decide **cuántos nodos, cuáles,
si agrega o edita**, y itera contra los tests hasta que pasan. El MCP de docs de
Synsema (`synsema-docs`) le da referencia del lenguaje + sandbox para verificar
snippets. Es el único servicio que escribe en `flujos/`.

### Jerarquía de fronteras (para no sobre-microservificar)
Worker (aislamiento de ejecución) y gateway (superficie pública estable) son
**innegociables**. Lienzo y builder podrían fusionarse en un proceso si separados
molestan — esa frontera es de conveniencia, no estructural.

### El Runtime (Synsema puro)
Cada automatización compila a un `flujo.syn` autónomo. Un nodo = una `task`.
El dato viaja así — **esto responde "¿cómo llega la salida del nodo 1 al nodo 6?"**:

```
let ctx be {}
set ctx["traer_pedidos"] to nodo_traer_pedidos(ctx)     -- nodo 1
set ctx["filtrar"]       to nodo_filtrar(ctx)           -- lee ctx["traer_pedidos"]
set ctx["aprobar"]       to nodo_aprobar(ctx)
set ctx["guardar"]       to nodo_guardar(ctx)
set ctx["resumen"]       to nodo_resumen(ctx)
set ctx["notificar"]     to nodo_notificar(ctx)         -- nodo 6: ctx["traer_pedidos"] sigue ahí
```

El map `ctx` es el "cable": cada salida queda bajo el id de su nodo durante toda la
corrida (como `$node["X"].json` en n8n, pero visible en el código). Tras cada nodo:
`sql_exec("INSERT INTO runs_snapshots ...", [run_id, nodo, json_encode(ctx)])`.
Ramas paralelas usan la otra primitiva: agentes con blackboard (`share`/`observe`),
cada rama publica bajo su clave y el nodo de merge las junta.

### El Lienzo (v1: se mira, no se arrastra)
Una UI servida por Synsema (`serve` + SSE para ver corridas en vivo) que **renderiza**
el grafo con auto-layout y muestra: nodos, cables, permisos del flujo, historial y
tests. Se manipula **conversando con el builder**, no arrastrando — eso es fiel a la
visión ("le vas pidiendo lo que querés") y evita construir un editor drag & drop
completo antes de validar la idea.

---

## Catálogo de nodos v1

| Nodo | Primitiva Synsema | Permiso que expone |
|---|---|---|
| Webhook entrante | `route "POST /..."` | `serve(puerto)` |
| HTTP / API externa | `http_*` (+ `json_encode` + header JSON) | `net("host")` |
| Base de datos | `sql` / `sql_exec` (SQLite/Postgres/MySQL) | `db(scope)` |
| IA: razonar/decidir/extraer | `reason` / `decide` / `analyze` | `llm` |
| Aprobación humana | `approve` / `confirm` (timeout fail-closed) | — |
| Transformar / filtrar | `apply` / `where` / `reduce` (puras) | — |
| Condición / rama | `when` / `match` | — |
| Notificar (chat Vereda, email vía API…) | `http_post` | `net(...)` |
| Credencial | `secret()` (redactada, LLM-proof) | `secret("NOMBRE")` |
| **Nodo Synsema (custom)** | una `task` escrita por el builder | solo lo que declare (a aprobar) |

## El nodo Synsema — el reemplazo del "Code node" (JS/Python)

n8n compensa sus límites con un Code node de JavaScript/Python: un cuerpo extraño,
sandboxeado aparte, en otro lenguaje que el del runtime. En Telar el escape hatch es
el propio lenguaje: **los nodos azúcar ya son Synsema por debajo** (el compilador
emite `task`s iguales), así que cuando el catálogo no alcanza, el builder simplemente
**escribe un nodo nuevo** usando el MCP `synsema-docs` (referencia + sandbox de
verificación) y lo somete al mismo ciclo: `check` → `test` → lienzo.

Tres propiedades que el Code node de n8n no tiene:

1. **El escape hatch no escapa de la jaula.** Un nodo custom sigue preso de las
   capabilities del flujo. Si necesita `net("api.x.com")`, eso aparece como un
   permiso nuevo que aprobás antes de que exista. Imposible que toque algo no visto.
2. **El caso común pide cero permisos.** El 80% del uso real del Code node es
   masajear datos (parsear, mapear, calcular, reformatear). En Synsema eso es código
   **puro** — `apply`/`where`/`reduce`/regex/`json_*`/math no requieren capability.
3. **Todo nodo custom es promovible al catálogo.** El contrato de nodo es uniforme:
   un módulo `.syn` con `export task nodo(ctx)`, su bloque `test` con entradas
   grabadas y su firma de capabilities. Un custom que funcionó se guarda, se comparte
   como archivo de texto y reaparece como azúcar para el próximo flujo. **El catálogo
   se auto-expande con el uso** — así se compensa la brecha de conectores.

## Disparadores (estrategia realista)

Todos los caminos terminan igual: **una fila en la cola (`runs`) que el worker consume**.

- **Evento (webhook)** — ✅ patrón probado en Vereda: llega a `gateway /wh/:flow/:trigger`,
  se graba la entrega y se encola la corrida.
- **Manual / prueba** — botón en el lienzo: encola directo, o re-envía una entrega
  grabada del gateway (replay).
- **Programado** — ⚠️ `cron_every` de Synsema v0.4.6 no dispara (bug verificado y
  reportable, ver `../reporte-cron-synsema.md`). Mientras tanto el scheduling es del
  SO apuntando al gateway: **systemd timers en Linux** (`OnCalendar=*:0/5` + `curl`),
  Task Scheduler en Windows. Ventaja: sobrevive reinicios y es observable con
  `systemctl list-timers`. Cuando Synsema arregle cron, el worker lo adopta sin
  tocar ningún flujo.

## Qué ya está probado (proyecto Vereda, esta misma carpeta)

Todo el runtime que Telar necesita ya lo ejercitamos de verdad:
`serve` con auth/validación/static, webhooks push entre dos servicios, LLM real
(MiniMax) con memoria conversacional inyectada, tests nativos por módulo,
módulos (`use`/`export`), capabilities denegando de verdad, y los gotchas de la
v0.4.6 documentados (HTTP client necesita `json_encode` + `Content-Type`;
la respuesta no trae `json`, usar `json_decode(body of r)`; cron roto).

## Hoja de ruta

- **Fase 0 (hecha):** validar las primitivas con un caso real (Vereda + agente pizzería).
- **Fase 1 (hecha):** el compilador `compilador/compilar.syn` (escrito en Synsema) compila
  `compilador/grafos/*.json` → `flujos/*.syn` y los valida con `synsema check`. Catálogo
  inicial en `flujos/nodos/` (base/refs, sql, http, condicion, llm, archivo — 8 tests) +
  nodo custom inline. Validado E2E con los 3 flujos: `resumen_ventas` (sql → custom →
  archivo), `pedido_grande` (webhook → condición → 2 http encadenados avisando por Vereda,
  con la rama negativa verificada) y `clasificar_consulta` (LLM real clasificando).
  Snapshots por nodo en `telar.db` (`ver.syn` los muestra). Setup: `setup.syn`.
- **Fase 2 (hecha, v1):** `builder.syn` (`synsema serve builder.syn`, :7001) — POST /pedir
  {"pedido": "..."} → el LLM propone el grafo, `generar()` lo compila, `synsema check` lo
  valida y si falla el error vuelve al LLM (hasta 3 intentos; solo se persiste lo que
  compila). La respuesta trae la superficie de permisos. Validado E2E: el pedido de
  clasificar reseñas con IA + aviso por Vereda salió bien al primer intento (5 nodos,
  refs encadenadas, solo_si) y el flujo corrió con ambas ramas verificadas.
  Nota estructural: los imports no pueden subir (`../` bloqueado), por eso los
  entrypoints (`builder.syn`, `compilar.syn`) viven en la raíz de telar/.
  Pendiente fase 2.1: tool-use real (multi-turno), preguntar por credenciales faltantes,
  promoción de customs al catálogo.
- **Fase 3 (hecha, v1):** `lienzo.syn` (:7000, `synsema serve lienzo.syn`) + UI en `lienzo/`.
  Grafo read-only con hilos entre nodos (hebra de color por tipo, permisos del flujo como
  chips), barra "Tejer" que le pide al builder por proxy, botón Probar que ejecuta el flujo
  con el ejemplo del trigger (proceso efímero vía `run()` con `TELAR_RUN_ID`/`TELAR_INPUT`),
  y corridas con snapshots por nodo (polling 3s). Validado E2E por HTTP: pedir → tejer →
  correr → ver snapshots. Nota: los servicios de prueba de la fase 0 (Vereda/pizzería)
  fueron eliminados; los flujos "avisar por Vereda" quedaron sin destino hasta el próximo canal.
- **Fase 2.1 (hecha):** el builder ahora corre el flujo con el ejemplo del trigger DENTRO
  del loop (`TELAR_RUN_ID=tj_<id>_<intento>`) y le devuelve el error de runtime al LLM —
  el `check` no caza refs inválidas ni templates rotos; una corrida real sí. La respuesta
  trae `probado: true` + `salida_prueba`, y la corrida de prueba queda visible en el lienzo.
  ⚠️ La corrida de prueba tiene efectos REALES (inserta filas, escribe archivos, llamaría
  APIs externas) — mismo trade-off que el modo test de n8n; sandbox de datos es trabajo futuro.
  Los flujos que apuntaban a Vereda fueron eliminados junto con sus corridas.
- **Fase 2.2 (hecha) — integraciones externas y credenciales de primera clase:**
  el nodo http llama a cualquier API (Evolution/WhatsApp, Meta Cloud API, mail por
  Resend/SendGrid — no hay SMTP en Synsema, se usa la API HTTP del proveedor).
  Credenciales: en headers como `{"Authorization": {"bearer": "VAR"}}` o
  `{"apikey": {"secret": "VAR"}}` — se leen del `.env`, se redactan en logs y el
  compilador emite `require secret("VAR")` automáticamente (escaneo recursivo de
  configs). Si falta la credencial, el builder entrega el flujo igual con
  `probado: false` + `faltan_credenciales: [...]` y el lienzo te pide cargarla —
  nunca se inventa ni se inline-a una key. El nodo http es **fail-loud**: un 4xx/5xx
  corta el flujo (opt-out `"tolerar_error": true`), así la corrida de prueba del
  builder caza APIs rotas. `POST /api/echo` en el lienzo para probar integraciones
  sin depender de servicios externos. Solo si el pedido no nombra ningún servicio,
  el aviso cae al buzón `./avisos/<destinatario>.txt` (nodo archivo `modo: append`).
- **Fase 2.3 (hecha) — credenciales sin tocar archivos:** Telar gestiona el `.env` por vos.
  `POST /api/credenciales {nombre, valor}` lo escribe (reemplaza o agrega la línea);
  `GET /api/credenciales` lista SOLO nombres. El lienzo muestra un panel de credenciales
  por flujo (✓ si está, input para pegarla si falta). Nada se reinicia: los flujos son
  procesos efímeros que releen el `.env` en cada corrida, y el builder chequea el archivo
  fresco (`cred_existe`), no su entorno de arranque. Validado E2E: credencial guardada por
  API → el builder la vio sin reiniciar → flujo probado con el header `apikey` correcto.
- **Fase 2.4 (hecha) — credenciales globales y a prueba de LLM:** las credenciales son
  una sola vez para TODOS los flujos (panel global en el sidebar del lienzo). El builder
  recibe en su prompt los NOMBRES ya cargados (nunca valores) y reusa el nombre existente
  en vez de inventar variantes (SHOPIFY_KEY vs SHOPIFY_TOKEN…). Guardián anti-fuga:
  si el pedido parece contener una key pegada (sk-…, Bearer …, tokens largos), el builder
  lo rechaza con 422 ANTES de llamar al modelo — el valor de una credencial jamás viaja
  al LLM; solo su nombre. El proxy del lienzo es passthrough (los 4xx del builder llegan
  intactos a la UI). Las credenciales se **editan y borran** desde la UI (links editar/borrar
  en ambos paneles; `POST` upsertea, `DELETE /api/credenciales/:nombre` la quita del .env).
  Verificado: valor editado → el flujo siguiente ya lo usa sin reiniciar nada (procesos
  efímeros releen el .env). El modelo de secretos es el oficial de Synsema (21-secrets):
  no hay vault aparte del .env; `secret()` es LLM-proof, materializa solo en el socket.
- **Fase 3.1 (hecha) — el nodo se abre:** clic en un nodo muestra su **config JSON editable**
  (Guardar recompila y valida; si no compila se restaura el flujo), su **chat propio** ("mi
  instancia se llama instancia-joel, cambiala" → el builder edita SOLO ese nodo con el grafo
  como contexto, mismo loop de check + prueba; si la prueba de runtime falla por servicio
  externo caído, el cambio se conserva con advertencia) y el **código .syn compilado** de ese
  nodo (GET /api/flujos/:id/fuente). Nota de diseño: cada nodo ES un JSON (su config en el
  grafo); su implementación es la task .syn del catálogo; el custom lleva las líneas Synsema
  en su JSON. La edición manual valida compilación — la validación de runtime la da "Correr flujo".
- **Fase 3.2 (hecha) — frontend en páginas, tema dual, home tipo chat:**
  `/` es la HOME (saludo por hora, composer grande — el botón Tejer aparece solo con texto,
  Enter envía —, chips de credenciales con alta rápida, grilla de telares) y `/taller` es el
  workspace (buscador de flujos, grafo, nodo, corridas, gestión de credenciales; deep-links
  `#flujo_id`). Sin frameworks ni build: **ES modules nativos** (`comun.js`, `credenciales.js`,
  `home.js`, `taller.js`) + `tema.css` con tokens — tema claro "papel de taller" y oscuro,
  default por `prefers-color-scheme`, toggle abajo del sidebar. Un solo acento (cobre) +
  líneas; tipos de nodo en chips mono delineados, sin colores. **Contexto automático**
  (default ON, toggle en el composer): el builder consulta el esquema REAL de telar.db
  (sqlite_master, fresco) + nombres de credenciales antes de diseñar.
- **Fase 3.2b (hecha) — el telar se charla, se versiona y se borra:**
  chat a nivel flujo con dos modos: **Preguntar** (consulta sin tocar nada — el LLM responde
  con el grafo, el código compilado y la última corrida como contexto: ideal para "¿por qué
  no funciona?") y **Pedir cambio** (edita el grafo entero: agregar/quitar/modificar nodos).
  **Versionado anti-loop**: toda mutación (chat de telar, chat de nodo, edición manual,
  sobrescritura por pedido nuevo, borrado) guarda el grafo previo en la tabla `versiones`
  con su motivo; panel "Versiones" con **restaurar** (y la actual se guarda antes de
  restaurar — ida y vuelta sin pérdida, verificado). **Borrar telar** = archivado suave
  (`archivado: true`, desaparece de la UI, recuperable restaurando; no hay builtin de
  borrar archivos en Synsema v0.4.6). Nota: editar por chat un telar archivado lo resucita.
- **Fase 3.3 (hecha) — ensayar un nodo suelto:** `ensayar.syn` (runner genérico) ejecuta UN
  nodo con un ctx dado, sin tocar runs/snapshots. En el panel del nodo la entrada viene
  precargada con el snapshot del nodo ANTERIOR de la última corrida (o el ejemplo del
  trigger), editable. **🧪 Ensayar** (default, seguro): puros (condicion, custom sin IO) y
  lecturas (sql_query, llm_decide) corren de verdad; los con efectos (sql_exec, http,
  archivo) muestran QUÉ HARÍAN — SQL con params resueltos, request completa con secretos
  como `«secreto:NOMBRE»` (sin materializarlos), contenido exacto del archivo. **⚡ Ejecutar
  real** (opt-in con confirmación): efectos de verdad. El custom puro corre en un
  mini-programa efímero. Endpoint: `POST /api/flujos/:fid/nodos/:nid/ensayar {ctx, modo}`.
  Nota: el runner declara capabilities amplias (net/file/db) — el ensayo real corre bajo
  ellas; el scoping por flujo sigue rigiendo las corridas normales.
- **Fase 4 (hecha) — gateway + worker + CRON:** la arquitectura del manifiesto completa.
  **`gateway.syn`** (:7002): `POST /wh/<flujo>` con URL estable (no se reinicia al
  recompilar flujos), guarda cada entrega y encola; `GET /entregas/:flujo` +
  `POST /reenviar/:eid` (replay); rechaza flujos archivados; rate limit. **`worker.syn`**
  (`synsema run`, loop propio): cada 2s toma pendientes de la cola y ejecuta cada corrida
  como proceso efímero (estados pendiente→corriendo→ok/error); cada 10s revisa los flujos
  con **trigger cron** (`{"tipo": "cron", "cada_segundos": N}`) y encola los vencidos —
  el loop explícito en modo `run` reemplaza al `cron_every` roto de v0.4.6. Validado E2E:
  webhook → cola → worker → fila en la base; replay re-ejecuta; cron demo (`vigilar_stock`)
  disparó cada 15s con condición y alerta a archivo. El builder ya sabe generar triggers
  cron ("cada 5 minutos…"). Correr todo: lienzo + builder + gateway (`synsema serve`) y
  worker (`synsema run`). Futuro: ramas paralelas (blackboard), catálogo comunitario,
  multi-tenant, HMAC en webhooks (verify_hmac + as_secret).

- **Fase 5 (hecha) — el builder consulta la doc oficial (MCP):** el LLM del builder ya no
  adivina la sintaxis de los nodos custom: `builder/mcp.syn` es un cliente MCP
  (streamable HTTP, JSON-RPC `tools/call`) de `https://docs.synsema.com/mcp`, y
  `preguntar()` en `builder.syn` arma el loop de herramientas — si el modelo responde
  `{"herramienta": "...", "args": {...}}` en vez del grafo, el builder ejecuta la
  herramienta y le devuelve el resultado (máx 6 vueltas). Herramientas: `search_docs`,
  `get_page` (10-syntax, 12-tasks-lambdas, 13-control-errors, 36-json…) y sobre todo
  **`run_synsema`: un sandbox donde prueba el código custom ANTES de entregar el grafo**.
  Validado E2E con MiniMax: pidió una página de la doc, iteró su nodo custom 5 veces en
  el sandbox y entregó un flujo que compiló y pasó la corrida de prueba (antes del MCP,
  el mismo pedido moría en 3 intentos escribiendo Python). De paso: `extraer_json` ahora
  escanea objetos JSON balanceados (aguanta varios JSON o prosa con llaves en la misma
  respuesta), el few-shot saltea grafos archivados, y el SPEC aclara que la memoria es
  automática (nada de nodos que toquen la tabla `charlas`) con un ejemplo real de código
  custom válido.

- **Fase 5.1 (hecha) — respuestas libres, no enlatadas:** `llm_decide` quedó documentado
  como lo que es (un clasificador entre opciones fijas) y el SPEC enseña el patrón de bot
  conversacional: nodo custom con `require llm`, prompt con `trigger.historial` + mensajes
  nuevos, `when llm_available() → give reason about prompt` + texto de respaldo. Refuerzos
  del loop de herramientas: el builder anuncia cuántas consultas quedan y, agotado el
  presupuesto, fuerza una última llamada de entrega ("respondé el grafo YA con lo
  aprendido") en vez de rendirse. Y `normalizar()` sanea el grafo sin depender del LLM:
  rechaza nodos custom que declaran `task` anidada (dejaban el nodo mudo — la corrida
  "pasaba" sin producir nada) y completa `"historial": []` en el ejemplo del trigger
  cuando hay memoria (en producción lo inyecta el worker; la corrida de prueba lo
  necesita). Comparación E2E con el mismo pedido: la versión `llm_decide` respondía
  "¡Buenas! Decime qué necesitás" ante "¿cuánto sale el tomate? ¿tenés lechuga?"; la
  versión libre respondió las dos preguntas y ofreció tomar el pedido.

- **Fase 5.2 (hecha) — login y licencia:** `seguridad.syn` (módulo compartido) + dos
  variables en el `.env` (`TELAR_USUARIO`/`TELAR_CLAVE`) activan el login: la UI muestra
  un velo de ingreso y toda la API del lienzo + `/entregas` y `/reenviar` del gateway
  exigen sesión (`auth with` nativo de Synsema; token Bearer `expira.firma` con
  HMAC-SHA256 sobre la clave — la clave nunca viaja ni se loguea; 12 h de vida;
  comparaciones en tiempo constante; 1 s de castigo por login fallido). Los webhooks
  `/wh/*` siguen públicos (protección por flujo) y las páginas estáticas son cáscaras
  sin datos. Sin las variables, Telar corre abierto (modo local) — y como el `.env` se
  lee fresco en cada request, activar/desactivar el login no requiere reiniciar.
  Verificado E2E: 401 sin/mal/vencido token, login ok → 200, gateway admin protegido,
  webhook público intacto. Licencia: Apache 2.0 (`LICENSE`).

## Riesgos honestos

- **Conectores:** n8n tiene 400+; acá cada integración es HTTP escrito por el LLM. Mitigación: el nodo Synsema custom + promoción al catálogo (ver arriba) — cada integración que alguien pidió una vez queda testeada y reutilizable.
- **Runtime joven:** ya encontramos 3 bugs reales en v0.4.6. Mitigación: los gotchas están documentados, hay workarounds para todos, y los flujos compilados no dependen de las partes rotas.
- **El lienzo editable (drag & drop) es caro:** por eso v1 es read-only y conversacional. Si la tesis funciona, el editor visual se justifica después.
- **Costo LLM del builder:** construir es caro, ejecutar es barato (los flujos corren sin LLM salvo que tengan nodos de IA).

---

*La tesis en una línea: las plataformas de automatización visual existen porque
escribir código era la barrera. Si la IA escribe, testea y explica el código —
lo que necesitás no es un editor de nodos: es un runtime seguro, auditable y sin
lock-in donde ese código pueda vivir. Eso es Synsema + Telar.*

## Licencia

[Apache 2.0](LICENSE).
