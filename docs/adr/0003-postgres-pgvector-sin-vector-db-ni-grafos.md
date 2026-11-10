# ADR-0003 — PostgreSQL + pgvector + FTS; sin base vectorial ni de grafos separadas

- Estado: **Propuesto** (revisar en Fase 3 y Fase 5)
- Fecha: 2026-11-10

## Contexto
Se necesita búsqueda híbrida, relaciones entre entidades y aislamiento estricto por usuario/tenant. Volumen esperado por usuario: 10⁵–10⁷ fragmentos.

## Decisión
Usar PostgreSQL con pgvector (HNSW), full-text search, tabla `relations` y CTEs recursivos para recorridos de 1–3 saltos. Row-Level Security como mecanismo de aislamiento. Acceso a recuperación detrás de una interfaz `RetrievalStore`.

## Alternativas
- Vector DB dedicada (Qdrant, Pinecone, Weaviate): mejor escala bruta, pero duplica el modelo de permisos y la sincronización; riesgo de fuga entre usuarios.
- Neo4j u otra base de grafos: útil para algoritmos de grafo y consultas profundas; innecesaria para el uso actual.
- Multi-vector tipo ColBERT: caro y complejo; se opta por multi-vista acotada (literal + abstracto).

## Condiciones para reconsiderar
p95 de búsqueda >300 ms con filtros; >50 M vectores en un tenant; necesidad de comunidades/caminos largos en grafo; requisitos de aislamiento físico por cliente.

## Consecuencias
+ Una sola fuente de verdad, transacciones y permisos, menos operación.
− Techo de escala menor que sistemas especializados; ajuste de índices necesario.
