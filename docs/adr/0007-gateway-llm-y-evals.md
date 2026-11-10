# ADR-0007 — Gateway LLM propio y fino, enrutamiento por tarea y evals desde el inicio

- Estado: **Propuesto**
- Fecha: 2026-11-10

## Contexto
Independencia de proveedor, costos variables por tarea y necesidad de medir calidad.

## Decisión
1. El dominio sólo conoce la interfaz `LLMGateway` (`complete`, `stream`, `embed`, `transcribe`, `tool_call`). Ningún SDK de proveedor fuera de adaptadores.
2. Enrutamiento por tarea (clasificación, extracción, análisis relacional, ideación, redacción) definido en configuración, con fallback.
3. Salidas estructuradas con JSON Schema + validación + reintentos.
4. `data_class` determina proveedores permitidos.
5. Cada llamada se registra (modelo, tokens, coste, latencia, tarea, workspace) sin guardar contenido sensible salvo configuración explícita.
6. **Evals**: set dorado propio versionado; toda cambio de prompt/modelo se compara antes de pasar a producción.
7. Embeddings versionados por modelo; reindexado como job.

## Alternativas
- Framework de orquestación completo: acopla el dominio a abstracciones volátiles.
- Un único proveedor: más simple pero contradice el principio de independencia.

## Consecuencias
+ Se puede cambiar de modelo con evidencia, controlar costos, soportar modelos locales.
− Mantener adaptadores y capacidades heterogéneas (tool use, streaming, JSON mode) con mínimo común denominador.
