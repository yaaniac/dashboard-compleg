# Dashboard: números hardcodeados y fórmulas raras

Inventario de lo que **no viene de API** o tiene **fórmulas / constantes raras**. Lo que el sync de Linear escribe en el HTML está marcado como OK (viene de API).

---

## 1. Script `sync-linear-to-dashboard.js` (hardcodeado)

| Campo | Valor actual | Problema |
|-------|--------------|----------|
| `avgCycleTime` | `11.3` | **Hardcodeado.** Debería calcularse: promedio de (completedAt − createdAt) en días sobre issues cerradas. |
| `avgCycleTimePrev` | `13.1` | **Hardcodeado.** Período anterior para el trend; no se calcula. |
| `velocityPrev` | `10.2` | **Hardcodeado.** Período anterior para el trend; no se calcula. |
| `generalSlaPrev` | `null` | Siempre null → `slaCompliancePrev` queda 0. No hay “período anterior” real. |
| Velocity (global y por equipo) | `totalClosed / 10` o `teamClosed.length / 10` | El **10** es “10 semanas” fijas. No filtra por fecha (completedAt); asume siempre 10 semanas. |

**Resumen:** Los “Prev” y el avg cycle time global son estáticos. La velocity usa una ventana fija de 10 semanas sin filtrar por fechas.

---

## 2. HTML – Datos estáticos (no los actualiza el sync)

### `weeklyData` (líneas ~665–676)
- **Qué es:** created / closed / openEnd por semana (W47–W5).
- **Problema:** Totalmente hardcodeado. El sync **no** escribe esto.
- **Idea:** Calcular en el sync a partir de issues: por semana, contar `createdAt` y `completedAt` y rellenar created/closed/openEnd.

### `cycleTimeData` (líneas ~683–688)
- **Qué es:** Cantidad de issues en rangos 0–3d, 4–7d, 8–14d, 15–30d, 30+d (días de ciclo).
- **Problema:** Números fijos (62, 93, 79, 69, 41). El sync **no** los actualiza.
- **Idea:** Calcular en el sync: para cada issue cerrada con createdAt y completedAt, calcular días y agrupar en esos rangos.

---

## 3. HTML – Filtros Roxom / Roxom TV (`statsByEntityView`)

- **Qué es:** Objetos `'Roxom'` y `'Roxom TV'` con total, totalOpen, byStatus, byTeam, byAssignee, overdueIssues, dueSoonIssues, etc.
- **Problema:** Todo hardcodeado. El sync solo actualiza `summaryStats` (Global), no estos objetos.
- **Consecuencia:** Al elegir Roxom o Roxom TV se ven datos viejos/fijos.

---

## 4. HTML – PGA (`teamDetailedData['PGA']`, `pgaDataByEntityView`)

- **Qué es:** Datos del equipo PGA (contracts) para Global, Roxom y Roxom TV.
- **Problema:** Valores fijos, por ejemplo:
  - `velocity: 1.6`, `1.1`, `0.6`
  - `avgCycleTime: 5.2`, `4.8`, `6.1`
  - `throughput: 1.6`, `1.1`, `0.6`
- No vienen del sync; son manuales.

---

## 5. Fórmulas raras o con magic numbers

### “Weeks to Clear” (Performance tab, tabla por equipo)
- **Fórmula:** `team.open / team.velocity`
- **Problema:** Si `team.velocity` es 0 (ej. PGA "0.0") → división por cero (Infinity / NaN).
- **Solución:** Mostrar "—" o "N/A" cuando velocity sea 0 o no numérico.

### “Efficiency” (By Person – pts/day ratio)
- **Fórmula:** `(total_points / closed_count) / avg_lead_time * 10`
- **Problema:** El **× 10** es un factor de escala arbitrario; no está documentado.
- **Sugerencia:** Dejar constante documentada (“escala ×10 para legibilidad”) o quitarla y mostrar el ratio sin escalar.

### Velocity en sync: “/ 10”
- **Fórmula:** `totalClosed / 10` (global), `teamClosed.length / 10` (por equipo).
- **Problema:** Asume “por cada 10 semanas” sin filtrar por fecha; si el dataset no son 10 semanas, el número es engañoso.
- **Sugerencia:** Filtrar issues por `completedAt` en las últimas N semanas y dividir por N.

---

## 6. Lo que está bien (viene de API o es intencional)

- **summaryStats** (totalOpen, totalClosed, byTeam, byAssignee, overdueIssues, closedIssues, etc.): lo escribe el sync desde Linear → OK.
- **assigneeDetailedData**: lo escribe el sync → OK.
- **performanceData**: lo escribe el sync → OK.
- **Target 80% within 14 days** y **Target ≤7 days**: umbrales de política → OK que estén fijos.
- **Data Quality completeness:** `(totalOpen * 4 - missing...) / (totalOpen * 4)` → el 4 son los 4 campos requeridos → OK.

---

## Resumen de prioridades

1. **Crítico (bug):** “Weeks to Clear” cuando velocity = 0 → evitar división por cero.
2. **Importante:** Calcular `avgCycleTime` (y opcionalmente Prev) en el sync; quitar 11.3 / 13.1 fijos.
3. **Importante:** Que el sync actualice `weeklyData` y/o `cycleTimeData` desde Linear (o al menos documentar que son estáticos).
4. **Medio:** Definir de dónde salen velocityPrev y avgCycleTimePrev (otro período, otra query) o dejarlos como “manual”.
5. **Bajo:** Documentar o revisar el × 10 en Efficiency; revisar ventana de 10 semanas en velocity.
