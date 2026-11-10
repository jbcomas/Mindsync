# MindSync — Documentación

Plataforma de inteligencia personal y colectiva. Estado: **planificación (pre-código)**. Todo es borrador v0.1 y propuesto, no decidido.

| Documento | Contenido |
|---|---|
| [01-product-definition.md](01-product-definition.md) | Visión, problema, usuarios, casos de uso, diferenciación, MVP |
| [02-architecture.md](02-architecture.md) | Componentes, flujos, modelo de datos, memoria, multi-LLM, acciones, seguridad, stack |
| [03-roadmap.md](03-roadmap.md) | Fases 0–6 con dependencias, riesgos y criterios de aceptación |
| [04-backlog.md](04-backlog.md) | Épicas, historias y tareas priorizadas |
| [05-open-decisions.md](05-open-decisions.md) | Decisiones pendientes con alternativas y recomendación |
| [06-privacy-legal.md](06-privacy-legal.md) | Privacidad, seguridad y consideraciones legales |
| [07-versiones-y-alcance.md](07-versiones-y-alcance.md) | Qué entra en V1, V2, V3, V4 y Futuro; matriz de cobertura del prompt |
| [08-revision-seguridad-aislamiento.md](08-revision-seguridad-aislamiento.md) | Revisión de seguridad: hallazgos, correcciones y checklist de aislamiento |
| [legal/consentimientos-v0.md](legal/consentimientos-v0.md) | Textos de consentimiento v0, revisión y puntos para el abogado |
| [adr/](adr/) | Architecture Decision Records |

## ADRs
- [0001 Monolito modular](adr/0001-monolito-modular.md)
- [0002 Fuentes inmutables y procedencia](adr/0002-fuentes-inmutables-y-derivados-regenerables.md)
- [0003 PostgreSQL + pgvector](adr/0003-postgres-pgvector-sin-vector-db-ni-grafos.md)
- [0004 Multi-tenant y compartición](adr/0004-multi-tenant-y-comparticion.md)
- [0005 Orquestador único](adr/0005-orquestador-unico-no-multiagente.md)
- [0006 Cifrado y claves](adr/0006-cifrado-y-claves.md)
- [0007 Gateway LLM y evals](adr/0007-gateway-llm-y-evals.md)
- [0008 Stack tecnológico (Aceptado)](adr/0008-stack-tecnologico.md)

Convención ADR: `adr/NNNN-titulo-corto.md`; estados: Propuesto → Aceptado → Reemplazado/Rechazado.
