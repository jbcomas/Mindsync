# ADR-0002 — Fuentes inmutables; conocimiento derivado regenerable, con procedencia obligatoria

- Estado: **Propuesto**
- Fecha: 2026-11-10

## Contexto
Los extractores y modelos mejorarán. Además, la confianza exige no perder nunca el origen de una afirmación, y distinguir ideas propias, ajenas, hipótesis, decisiones e IA.

## Decisión
1. Toda captura se guarda como `source` inmutable (con hash y contexto).
2. Entidades, relaciones, embeddings y resúmenes son **derivados**: se pueden regenerar desde las fuentes.
3. Todo derivado referencia sus fuentes (`provenance`: fuente, fragmento, cita, quién lo afirmó).
4. Campos obligatorios: `origin_kind`, `epistemic_status`, `confidence`, `validation_state`.
5. La IA nunca crea registros `own_thought` ni `confirmed`. Observación e inferencia viven en filas distintas.
6. Las correcciones del usuario tienen precedencia y sobreviven al reprocesado.

## Alternativas
- Guardar sólo resúmenes/hechos: pierde evidencia, imposible reprocesar.
- Event sourcing completo: potente pero costoso; se adopta de forma parcial (historial por entidad + fuentes append-only).

## Consecuencias
+ Auditabilidad, reprocesado, base para cumplimiento (acceso/borrado por persona).
− Más almacenamiento y esquema más complejo; borrar una fuente exige cascada de derivados.
