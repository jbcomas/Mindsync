# ADR-0005 — Orquestador único con herramientas; pipelines determinísticos donde sea posible

- Estado: **Propuesto**
- Fecha: 2026-11-10

## Contexto
La visión menciona agentes por usuario y agentes colaborando entre usuarios. Los sistemas multiagente aumentan costo, latencia, no determinismo y superficie de seguridad.

## Decisión
- Ingestión, consolidación e insights: **workflows/pipelines** con pasos LLM acotados y salidas estructuradas.
- Chat/asistente: **un orquestador** con tool-calling (búsqueda, lectura de entidades, acciones, MCP), con límite de pasos y presupuesto de tokens.
- "Agente personal" = el orquestador ejecutándose con el contexto y permisos de un usuario.
- Multiagente real sólo cuando (a) haya trabajo paralelizable con contexto aislado, o (b) fronteras de permiso/confidencialidad exijan contextos separados (Fase 5: el agente de A y el de B no comparten contexto; la síntesis se hace sobre el material aportado en un espacio común).

## Consecuencias
+ Más simple de evaluar, depurar y costear.
− Menos "autonomía" visible; se compensa con buenos jobs proactivos.
Revisar si evals muestran que un patrón multiagente mejora calidad de forma medible.
