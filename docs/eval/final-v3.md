# Evaluación de extracción — final-v3

- Prompt: **v3** · casos: **test** · 2026-11-10T23:55:49.622Z
- Los casos los escribí yo (no son reuniones reales): sirven para comparar, no para predecir el rendimiento con tus reuniones.

| modelo | recall | completos* | tipo | hablante | estado epist. | contenido | ruido** | violaciones | relaciones | citas inventadas | fallos | tokens ent/sal | USD | ms/llamada |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic:claude-sonnet-5-5 | 96% | **96%** | 100% | 100% | 100% | 100% | 0% | **0** | 100% | 0% | 0/10 | 28506/12347 | $0.180 | 7731 |
| anthropic:claude-haiku-5-5 | 93% | **89%** | 95% | 100% | 100% | 95% | 2% | **0** | 50% | 0% | 0/10 | 28506/20133 | $0.013 | 8397 |

\* *completo* = encontrado con la cita correcta Y tipo, hablante, estado epistémico y contenido correctos. ** *ruido* = items extraídos que no estaban esperados ni permitidos (puede incluir items válidos que no etiqueté: revisar la lista).

## anthropic:claude-sonnet-5-5

Faltantes 2 · tipo 0 · hablante 0 · estado 0 · contenido 0 · extras 0 · **violaciones 0**

**nota-spanglish** — 4/5 completos, 8 extraídos
- ❌ falta apikey: «todavía no tengo la API key de OpenAI, so tengo que pedírsela a Carla hoy»

**nota-spanglish** — 4/5 completos, 8 extraídos
- ❌ falta apikey: «todavía no tengo la API key de OpenAI, so tengo que pedírsela a Carla hoy»

## anthropic:claude-haiku-5-5

Faltantes 3 · tipo 2 · hablante 0 · estado 0 · contenido 2 · extras 1 · **violaciones 0**

**ventas-preferencias** — 4/5 completos, 7 extraídos
- ❌ falta mails: «no me gustan los mails largos. Prefiero que me escriban cortito y que me llamen si es urgente»
- ➕ extra [concept] Preferencia por mails cortos y llamadas si es urgente  ← «Prefiero que me escriban cortito y que me llamen si es urgente.»

**nota-spanglish** — 4/5 completos, 8 extraídos
- ❌ falta apikey: «todavía no tengo la API key de OpenAI, so tengo que pedírsela a Carla hoy»

**nota-spanglish** — 4/5 completos, 7 extraídos
- ❌ falta apikey: «todavía no tengo la API key de OpenAI, so tengo que pedírsela a Carla hoy»

**negaciones-pausa** — 4/5 completos, 8 extraídos
- ⚠ tipo firmar: esperado task, salió decision («Avanzar con el proveedor A»)
- ⚠ contenido firmar: faltan [["firmar"],["15","quince"]] en «Avanzar con el proveedor A — Se opta por la opción A como proveedor, en lugar de la opción B descartada.»

**negaciones-pausa** — 4/5 completos, 9 extraídos
- ⚠ tipo firmar: esperado task, salió decision («Avanzar con la opción A (proveedor A)»)
- ⚠ contenido firmar: faltan [["firmar"],["15","quince"]] en «Avanzar con la opción A (proveedor A) — Se adopta la opción A como proveedor elegido. Pendiente de firma antes del quince.»
