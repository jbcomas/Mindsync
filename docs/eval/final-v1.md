# Evaluación de extracción — final-v1

- Prompt: **v1** · casos: **test** · 2026-11-10T23:55:05.758Z
- Los casos los escribí yo (no son reuniones reales): sirven para comparar, no para predecir el rendimiento con tus reuniones.

| modelo | recall | completos* | tipo | hablante | estado epist. | contenido | ruido** | violaciones | relaciones | citas inventadas | fallos | tokens ent/sal | USD | ms/llamada |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic:claude-sonnet-5-5 | 100% | **93%** | 93% | 100% | 100% | 100% | 1% | **0** | 100% | 0% | 0/10 | 20056/11032 | $0.150 | 7328 |
| anthropic:claude-haiku-5-5 | 80% | **74%** | 92% | 100% | 100% | 95% | 1% | **0** | 0% | 0% | 0/10 | 20056/21800 | $0.013 | 9180 |

\* *completo* = encontrado con la cita correcta Y tipo, hablante, estado epistémico y contenido correctos. ** *ruido* = items extraídos que no estaban esperados ni permitidos (puede incluir items válidos que no etiqueté: revisar la lista).

## anthropic:claude-sonnet-5-5

Faltantes 0 · tipo 3 · hablante 0 · estado 0 · contenido 0 · extras 1 · **violaciones 0**

**nota-spanglish** — 5/5 completos, 9 extraídos
- ➕ extra [event] Ensayo del miércoles  ← «book the room para el ensayo del miércoles»

**ventas-preferencias** — 4/5 completos, 8 extraídos
- ⚠ tipo mails: esperado concept|idea, salió person («Carolina»)

**ventas-preferencias** — 4/5 completos, 8 extraídos
- ⚠ tipo mails: esperado concept|idea, salió person («Carolina»)

**dialogo-rapido** — 3/4 completos, 6 extraídos
- ⚠ tipo logo: esperado task, salió person («Mariana»)

## anthropic:claude-haiku-5-5

Faltantes 9 · tipo 3 · hablante 0 · estado 0 · contenido 2 · extras 1 · **violaciones 0**

**ventas-preferencias** — 3/5 completos, 7 extraídos
- ❌ falta mails: «no me gustan los mails largos. Prefiero que me escriban cortito y que me llamen si es urgente»
- ❌ falta zoho: «estamos mirando también a Zoho, así que necesito una comparación»
- ➕ extra [idea] Preferencia de comunicación: mails cortos y llamadas si es urgente  ← «Prefiero que me escriban cortito y que me llamen si es urgente.»

**ventas-preferencias** — 4/5 completos, 7 extraídos
- ❌ falta zoho: «estamos mirando también a Zoho, así que necesito una comparación»

**nota-spanglish** — 4/5 completos, 9 extraídos
- ❌ falta apikey: «todavía no tengo la API key de OpenAI, so tengo que pedírsela a Carla hoy»

**nota-spanglish** — 4/5 completos, 7 extraídos
- ❌ falta apikey: «todavía no tengo la API key de OpenAI, so tengo que pedírsela a Carla hoy»

**negaciones-pausa** — 4/5 completos, 8 extraídos
- ⚠ tipo firmar: esperado task, salió decision («Avanzar con la opción A»)
- ⚠ contenido firmar: faltan [["firmar"],["15","quince"]] en «Avanzar con la opción A — Se acordó seguir con la opción A como proveedor.»

**dialogo-rapido** — 1/4 completos, 5 extraídos
- ❌ falta informe: «Que lo tengo yo. Lo termino mañana a la tarde»
- ❌ falta dominio: «hay que renovar el dominio, vence el 30»
- ⚠ tipo logo: esperado task, salió person («Mariana»)

**dialogo-rapido** — 3/4 completos, 6 extraídos
- ❌ falta informe: «Que lo tengo yo. Lo termino mañana a la tarde»

**negaciones-pausa** — 4/5 completos, 8 extraídos
- ⚠ tipo firmar: esperado task, salió decision («Avanzar con proveedor A»)
- ⚠ contenido firmar: faltan [["firmar"],["15","quince"]] en «Avanzar con proveedor A — Se decide ir con la opción A como proveedor.»

**injection-montos** — 3/4 completos, 5 extraídos
- ❌ falta impaga: «una factura de 2.300 dólares que sigue impaga desde septiembre, de la empresa Delta»
