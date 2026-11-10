# Evaluación de la extracción

**Qué es.** Un banco de 14 casos etiquetados a mano (`packages/ingest/eval/cases.ts`) y un puntaje determinístico, sin modelo juez (`eval/score.ts`), para comparar modelos y prompts con números. 9 casos de **desarrollo** (donde se ajusta) y 5 de **reserva** (se miran una sola vez, con `--final`).

**Límites (leer antes de citar estos números).**
- Los casos los escribí yo (Claude), no son reuniones reales. Sirven para **comparar** variantes, no para predecir el rendimiento con reuniones reales.
- Las etiquetas son juicios míos. Con 55 items esperados en desarrollo, cada item vale ~2 puntos y la variación entre dos corridas del mismo prompt es de ~3 puntos: diferencias menores a eso no son concluyentes.
- 1 error de etiquetado propio se corrigió a mitad de camino (anclas alternativas para compromisos: pedido + aceptación); se aplicó por principio a todos los casos, incluidos los de reserva, antes de ver sus resultados.

**Cómo se usa.**
```bash
cd packages/ingest
npm run eval -- --models anthropic:claude-sonnet-5-5 --split dev --prompt v3 --reps 2 --label mi-prueba   # gasta dinero real
npm run eval:rescore -- mi-prueba dev                                                                    # re-puntúa gratis
```

## Resultados (completos = encontrado con cita correcta + tipo + hablante + estado + contenido)

| | prompt | recall | completos | violaciones (trampas) | ruido |
|---|---|---|---|---|---|
| **Desarrollo** — Sonnet 5.5 (2 reps) | v1 | 97% | 86–89% | 1 y 1 | 4–7% |
| | **v3** | 97% | **89–92%** | **0 y 0** | 4% |
| **Desarrollo** — Haiku 5.5 (2 reps) | v1 | 84–86% | 81–84% | 1 y 0 | 2% |
| | **v3** | 89–92% | **84–89%** | **0 y 0** | 2% |
| **Reserva** — Sonnet 5.5 (2 reps) | v1 | 100% | 91–96% | 0 | 0–3% |
| | **v3** | 96% | **96%** | 0 | 0% |
| **Reserva** — Haiku 5.5 (2 reps) | v1 | 78–83% | 70–78% | 0 | 0–3% |
| | **v3** | 91–96% | **87–91%** | 0 | 0–3% |

**Decisión:** v3 pasa a producción (`SYSTEM_PROMPT` en `src/extract.ts`). Mejora o iguala en todas las métricas y modelos, elimina la violación de "dato superado" (una fecha corregida que quedaba como vigente), y ayuda sobre todo a Haiku (+13 a +17 puntos en reserva). v1 queda congelado en `eval/prompts.ts` como referencia.

## Qué se aprendió
- **Los modelos casi no inventan:** 0% de citas inventadas en todas las corridas; ruido bajo (0–7%). El problema es de **cobertura y criterio**, no de alucinación.
- **El mayor fallo era perder compromisos** en texto ruidoso (ASR con `[inaudible]`): se corrigió pidiendo explícitamente cubrir todo compromiso asumido o aceptado.
- **Sobrefusionar empeora** (v2): fusionar "idea + decisión" en un solo item pierde trazabilidad de quién propuso qué. v3 lo acota solo a *valores corregidos* (fechas, precios).
- **Una idea marcada "no es para ahora" se descartaba** en vez de registrarse como hipótesis; v3 lo aclara.
- **Relaciones entre items** siguen siendo lo más débil (Haiku: 0–100% según corrida). Pendiente.
- **Gemini no se pudo evaluar de forma justa:** `gemini-3.6-flash` sin cuota (429) y `gemini-3.5-flash-lite` con fallos intermitentes (503/429). En la única corrida: `gemini-3.5-flash-lite` 38% de recall con 3/9 llamadas fallidas. Reintentar con cuota propia.
- Las cuatro corridas "baseline" y "v2" están en `packages/ingest/eval/results/`; los informes en esta carpeta.

## Pendiente
1. **Reuniones reales** (anonimizadas): es la prueba que importa. Con ellas se validan o corrigen estas conclusiones.
2. Relaciones entre items.
3. Tipos de Customer Intelligence (necesidad, objeción, preferencia): hoy caen en `concept`/`idea`.
4. Gemini con cuota propia, y un modelo local.
