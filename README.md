# Compliance & Legal Dashboard (Roxom)

Dashboard de Compliance & Legal que consume datos de **Linear**. Una sola página HTML con pestañas (Executive, By Team, By Person, OKRs, Workload, Risk, Performance, Data Quality, Análisis con IA). Los datos se inyectan en el HTML mediante un script de sincronización.

## Requisitos

- **Node.js** (v18+ recomendado) — solo para actualizar datos desde Linear.
- **Navegador** — para ver el dashboard (el HTML se abre directo, no hay build).

## Cómo levantar el dashboard

1. **Clonar el repo** (o descargar y descomprimir).

2. **Assets (opcional)**  
   El HTML referencia imágenes en `assets/`:
   - `assets/horizontal_black.png` — logo principal
   - `assets/Roxom iso_black.png` — ícono Roxom
   - `assets/RoxomTV Isologo.png` — ícono Roxom TV  
   Si no existen, el dashboard funciona igual; los logos no se verán.

3. **Ver el dashboard**  
   - Abrir en el navegador:  
     `compliance_dashboard_v14_roxom (1).html`  
   - O servir la carpeta (útil si más adelante tenés CORS o rutas raras):  
     `npx serve .`  
     y entrar a la URL que indique (ej. `http://localhost:3000`).

4. **Actualizar datos desde Linear**  
   - Crear una API key en [Linear → Settings → API](https://linear.app/settings/api).  
   - **Opción A — Variable de entorno (recomendado):**
     ```bash
     cp .env.example .env
     # Editar .env y poner tu LINEAR_API_KEY=
     export $(cat .env | xargs)   # Linux/macOS
     node sync-linear-to-dashboard.js
     ```
   - **Opción B — Inline:**
     ```bash
     LINEAR_API_KEY=lin_api_xxxx node sync-linear-to-dashboard.js
     ```
   - El script sobrescribe el mismo HTML con los datos actuales. Después recargar la página en el navegador.

**Importante:** No subas `.env` ni tu API key a GitHub. Usá `.env.example` como plantilla (ya está en `.gitignore` lo que no debe subirse).

---

## Levantar / actualizar desde Claude (o otro asistente) con MCP

Si la otra persona usa **Claude (o Cursor)** con **Linear MCP**:

1. **Solo ver el dashboard**  
   Clonar el repo, abrir el HTML en el navegador (o `npx serve .`). No hace falta API key.

2. **Actualizar datos usando la API de Linear desde el asistente**  
   - El asistente puede ejecutar en la terminal (con tu permiso):  
     `LINEAR_API_KEY=... node sync-linear-to-dashboard.js`  
   - Para no poner la key en claro: que la persona tenga `.env` local con `LINEAR_API_KEY` y ejecute:  
     `node sync-linear-to-dashboard.js`  
     en una shell donde ya se haya cargado el `.env` (por ejemplo `source .env` o usando `dotenv` si agregás un `package.json`).

3. **Flujo alternativo con MCP (Linear)**  
   - Si el asistente tiene acceso a **Linear vía MCP**, puede obtener issues con las herramientas MCP y guardarlas en un JSON.  
   - El script acepta un archivo JSON como argumento (issues en formato Linear):  
     `node sync-linear-to-dashboard.js issues-export.json`  
   - En el repo hay scripts de referencia: `sync-with-mcp.js`, `update-from-mcp.js`, `fetch-all-teams-mcp.sh`. El flujo principal y soportado es `sync-linear-to-dashboard.js` con `LINEAR_API_KEY` o con un JSON de issues.

**Resumen para quien usa Claude + MCP:**  
- Ver dashboard: abrir el HTML.  
- Refrescar datos: ejecutar `node sync-linear-to-dashboard.js` con `LINEAR_API_KEY` en el entorno, o pasar un JSON de issues si lo obtuvieron por MCP.

---

## Estructura del repo

| Archivo | Uso |
|--------|-----|
| `compliance_dashboard_v14_roxom (1).html` | Dashboard (abrir en navegador). |
| `sync-linear-to-dashboard.js` | Script principal: lee Linear (API o JSON) y actualiza el HTML. |
| `.env.example` | Plantilla de variables de entorno (copiar a `.env` y completar). |
| `sync-with-mcp.js` / `update-from-mcp.js` | Referencia para flujos MCP; el flujo estándar es el script principal. |
| `HARDCODED-Y-FORMULAS.md` | Notas sobre fórmulas y datos fijos en el dashboard. |

---

## Seguridad

- **No commitear** `.env`, `LINEAR_API_KEY` ni ninguna clave.  
- El `.gitignore` ya excluye `.env` y archivos sensibles.  
- Si subiste una key por error, revocarla en Linear y generar una nueva.

---

## ¿Si paso solo el HTML, la otra persona puede correrlo y actualizarlo con MCP de Linear?

- **Solo ver el dashboard:** Sí. Con el HTML en su máquina puede abrirlo en el navegador y ver todo con los datos que ya vienen embebidos (los que tenía cuando lo exportaste).
- **Actualizar datos (incl. con MCP de Linear):** Necesita también el **script** `sync-linear-to-dashboard.js`. El script es el que escribe en el HTML los datos nuevos. Además:
  - El script espera el HTML en la **misma carpeta** y con el nombre exacto: `compliance_dashboard_v14_roxom (1).html` (o hay que editar la constante `HTML_FILE` en el script).
  - Para actualizar tiene dos opciones:
    1. **Con API key de Linear:** `LINEAR_API_KEY=... node sync-linear-to-dashboard.js`
    2. **Con MCP de Linear:** obtener issues con las herramientas MCP, guardarlas en un JSON y ejecutar: `node sync-linear-to-dashboard.js issues.json`

**Resumen:** Pasar **HTML + `sync-linear-to-dashboard.js`** (y opcionalmente `.env.example` / README). Solo con el HTML se puede ver pero no actualizar.

---

## Reglas y fórmulas del dashboard

Definiciones y fórmulas que usa el sync y el HTML. Si alguien mantiene o extiende el dashboard, tiene que respetar estas reglas.

### 1. Equipos y estados (sync)

| Constante | Valor | Uso |
|-----------|--------|-----|
| **MAIN_TEAMS** | `['Comp-leg', 'FCP', 'LTO', 'RPA']` | "All" / totales = solo estos 4 equipos. PGA se muestra aparte. |
| **OPEN_STATUSES** | `['Backlog', 'Todo', 'In Progress', 'In Review', 'On Hold']` | Una issue cuenta como **abierta** solo si su estado está en esta lista. Excluye Pending Signature (PGA). |
| **PRIORITY_ORDER** | `['Urgent', 'High', 'Medium', 'Low', 'None']` | Orden fijo en gráficos de prioridad. |
| **PRIORITY_MAP** | `0→None, 1→Urgent, 2→High, 3→Medium, 4→Low` | Mapeo de valor numérico Linear → etiqueta. |
| **SHIRT_LABELS** | `['XS', 'S', 'M', 'L', 'XL']` | Tallas; lo que no matchea = "Missing". |

**Mapeo de nombres de equipo Linear → dashboard:**  
`Financial Crime Prevention` → FCP, `Legal Tech Operations` → LTO, `Regulatory and Public Affairs` / `Regulatory Public Affairs` → RPA, `Comp-leg` → Comp-leg, `PGA` → PGA.

### 2. Métricas globales (sync)

| Métrica | Fórmula / regla |
|--------|------------------|
| **totalOpen** | Cantidad de issues con estado en `OPEN_STATUSES` y equipo en MAIN_TEAMS + PGA (según contexto). |
| **totalClosed** | Issues en estado Done, equipos MAIN_TEAMS (PGA se cuenta aparte en byTeam). |
| **overdue** | Open con `dueDate` &lt; hoy. |
| **dueSoon** | Open con due date en los próximos 3 días (configurable en HTML). |
| **avgCycleTime** | Promedio de `(completedAt - createdAt)` en días, sobre todas las issues cerradas (MAIN_TEAMS) que tengan ambas fechas. |
| **avgCycleTimePrev** | Igual que avgCycleTime pero solo issues cerradas en el **período anterior** (8–4 semanas atrás). |
| **velocity** | `(issues cerradas en las últimas 10 semanas) / 10` — issues/semana (solo MAIN_TEAMS, con `completedAt` en ventana). |
| **velocityPrev** | `(issues cerradas en semanas 8–4 atrás) / 4`. |
| **slaCompliance** | Mismo valor que avgCycleTime (promedio días creación → cierre). |
| **slaCompliancePrev** | Mismo valor que avgCycleTimePrev. |

Ventanas de tiempo en el sync:
- **Últimas 10 semanas:** `completedAt >= now - 10*7 días`.
- **Período anterior 4 semanas:** `completedAt` entre `now - 8*7` y `now - 4*7` días.

### 3. Por equipo (sync)

- **open / closed / overdue:** Filtro por `team` (incluye PGA).
- **velocity (por equipo):** `(issues cerradas de ese equipo en últimas 10 semanas) / 10`.
- **sla (por equipo):** Promedio de días (createdAt → completedAt) de las cerradas de ese equipo. Si no hay cerradas con fechas, `null` (en el HTML se muestra "N/A").

### 4. weeklyData (sync)

- **11 semanas** hacia atrás desde la semana actual (lunes a lunes).
- Por semana: **created** = issues (MAIN_TEAMS) con `createdAt` en esa semana; **closed** = issues cerradas (MAIN_TEAMS) con `completedAt` en esa semana; **openEnd** = open al cierre de esa semana (calculado acumulando created - closed hacia atrás).

### 5. cycleTimeData (sync)

- Solo issues cerradas (MAIN_TEAMS) con `createdAt` y `completedAt`.
- Días = `completedAt - createdAt`; se agrupa en: **0-3d**, **4-7d**, **8-14d**, **15-30d**, **30+d**.

### 6. Fórmulas en el HTML (sin re-sync)

| Dónde | Fórmula | Notas |
|-------|---------|--------|
| **Throughput ratio (por equipo)** | `closed / open` | Si open = 0 se muestra "0.00" o "—". &gt;1 = cierran más de lo que tienen abierto. |
| **Throughput ratio (global)** | Promedio de los ratios por equipo (solo equipos con open &gt; 0). | |
| **Weeks to Clear** (Performance) | `team.open / team.velocity` | Si velocity = 0 → se muestra "—" (evitar división por cero). |
| **Efficiency** (By Person) | `(total_points / closed_count) / avg_lead_time * 10` | El ×10 es factor de escala para legibilidad. |
| **Data Quality completeness** | `(totalOpen*4 - missingShirt - missingCompany - missingGroup - missingWorkType) / (totalOpen*4)` | 4 = cantidad de campos requeridos (Shirt Size, Company, Group, Work Type). |

### 7. Data Quality (sync)

- Solo issues **abiertas** de **MAIN_TEAMS** (estados open).
- **missingShirt / missingCompany / missingGroup / missingWorkType:** conteos por equipo. Las etiquetas de grupo aceptan variantes (ej. "Roxom", "Roxom Global", "Roxom TV") para considerar que tiene Group.
- **completeness (por equipo):** porcentaje de esos 4 campos completos sobre el total de open del equipo.

### 8. Work Type (OKRs / BAU)

- **OKRs:** open con algún label que contenga "okr" (case insensitive).
- **BAU:** open con algún label que contenga "bau".
- **Unclassified:** el resto.

### 9. Objetivos fijos (HTML)

- **Target cycle time:** "80% of issues completed within 14 days" (comparado con cycleTimeData).
- **Target SLA:** "≤7 days average" (comparado con slaCompliance por equipo).

Documentación detallada de números que antes estaban fijos o con magic numbers: ver `HARDCODED-Y-FORMULAS.md`.
