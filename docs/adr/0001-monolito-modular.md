# ADR-0001 — Monolito modular en lugar de microservicios

- Estado: **Propuesto**
- Fecha: 2026-11-10

## Contexto
Equipo muy pequeño, producto aún no validado, dominios con fronteras todavía inciertas (memoria, insights, acciones, colectivo).

## Decisión
Un único despliegue (monolito modular) con módulos de dominio separados (Capture, Ingestion, Memory, Retrieval, Insight, CustomerIntelligence, Actions, Policy, LLMGateway) y workers asíncronos desde el mismo código. Los módulos se comunican por interfaces explícitas, no por acceso directo a tablas ajenas.

## Alternativas
- Microservicios desde el inicio: sobrecarga operativa, consistencia distribuida, sin beneficio hasta tener escala/equipos.
- Serverless de funciones sueltas: complica jobs largos (transcripción) y control de aislamiento.

## Consecuencias
+ Simplicidad, transacciones únicas, velocidad de cambio.
− Hay que vigilar el acoplamiento (reglas de dependencia en CI).
Se extraerá un módulo sólo cuando exista un dolor medido (escala, aislamiento de seguridad, equipo).
