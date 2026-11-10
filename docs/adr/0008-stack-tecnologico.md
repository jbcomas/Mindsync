# ADR-0008 — Stack tecnológico: TypeScript de punta a punta + Swift para iOS

- Estado: **Aceptado** (decisión delegada por el dueño del producto el 2026-11-10; revisable)
- Fecha: 2026-11-10

## Contexto
Una sola persona al inicio, con Mac disponible. Necesidades: API, workers asíncronos, web/PWA, app iOS de captura, gateway multi-LLM con salidas estructuradas, PostgreSQL con RLS y pgvector.

## Decisión
| Capa | Elección | Motivo |
|---|---|---|
| Lenguaje backend y web | **TypeScript** (Node 22 LTS) | Un solo lenguaje y tipos compartidos entre API, workers y web; SDKs de LLM de primera clase; validación con Zod = contratos de salida estructurada |
| API | **Fastify** + Zod (OpenAPI generado) | Liviano, rápido, sin la ceremonia de NestJS; el monolito modular se organiza por carpetas/dominios |
| DB | **PostgreSQL 16+** (pgvector, FTS, RLS) | ADR-0003 |
| ORM/migraciones | **Drizzle** + SQL explícito para RLS e índices | Control del SQL; RLS y HNSW no se esconden detrás de un ORM |
| Jobs | **pg-boss** (cola sobre Postgres) | Sin Redis en V1; transaccional con los datos |
| Web | **Next.js (React) + PWA** | Captura y revisión; reutiliza tipos |
| iOS | **Swift / SwiftUI nativo mínimo** (share extension, App Intents, widget, Action Button, subida en segundo plano) | Es lo único que da baja fricción real en iPhone; tenés Mac |
| Object storage | S3-compatible (Cloudflare R2/S3; MinIO en dev) | Portabilidad |
| ASR | API con diarización en V1 (interfaz intercambiable); `whisper.cpp`/faster-whisper como sidecar local opcional | Mejor calidad para empezar; privacidad opcional después |
| Embeddings | Modelo multilingüe elegido en benchmark de Fase 0, versionado | ADR-0007 |
| Infra dev | Docker Compose (Postgres, MinIO, app, worker) | Reproducible |
| Despliegue V1 | Un contenedor API + un worker + Postgres gestionado | Simple; migrable |
| Observabilidad | OpenTelemetry + tabla `llm_calls` | Costos y calidad desde el día 1 |
| Testing | Vitest + tests de integración con Postgres real + suite de evals | El aislamiento RLS se prueba contra DB real |

Python queda **fuera** de V1. Si un componente de ML lo exige (diarización local, re-ranker), se aísla como servicio sidecar con contrato HTTP.

## Alternativas
- Python/FastAPI: mejor ecosistema ML, pero dos lenguajes en cuanto haya web; se descarta mientras ASR/embeddings sean APIs.
- NestJS: estructura más rígida; innecesaria para un monolito modular de un desarrollador.
- React Native/Expo para iOS: no evita el código nativo de extensiones; se descarta.
- Supabase: acelera auth/RLS/storage, pero acopla; se puede usar sólo su Postgres gestionado si conviene (decisión de hosting aparte).

## Consecuencias
+ Un lenguaje, tipos de extremo a extremo, pocas piezas móviles.
− Menos librerías de ML en el proceso principal (mitigado con sidecars).
− La app iOS es una base de código aparte (Swift) que hay que mantener.
