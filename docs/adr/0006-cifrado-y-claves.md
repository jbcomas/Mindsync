# ADR-0006 — Cifrado con claves por tenant (envelope); E2EE diferido

- Estado: **Propuesto**
- Fecha: 2026-11-10

## Contexto
Se promete privacidad y control, pero el producto necesita que el servidor procese contenido (transcribir, extraer, buscar, llamar a LLMs).

## Decisión
- TLS en tránsito; cifrado en reposo con **envelope encryption** (DEK por tenant, KEK en KMS).
- Audio y archivos en bucket privado con URLs firmadas efímeras.
- Se **difiere E2EE puro**: es incompatible con procesamiento server-side e IA en la nube. Alternativas futuras: modo local-only, o enclaves confidenciales (TEE) para clientes enterprise.
- Honestidad con el usuario: el contenido se envía a los proveedores de LLM elegidos; se comunica qué se envía y se ofrece modelo local.

## Corrección de alcance (revisión de seguridad A-6)
Las claves por tenant aplican a **object storage** (audio, archivos), donde permiten borrado criptográfico. Las filas de Postgres no se cifran por columna con claves por tenant, porque eso rompería FTS y la búsqueda vectorial: se usa cifrado de disco del proveedor y borrado lógico + físico, con backups de retención limitada ([30] días) informada al usuario.

## Alternativas
- E2EE desde el día 1: máxima privacidad pero mata búsqueda semántica y colectivo; rechazado para el MVP.
- Sin claves por tenant: más simple, pero impide BYOK/borrado criptográfico enterprise.

## Consecuencias
+ Borrado criptográfico por tenant; base para BYOK.
− Gestión de claves y rotación; el operador técnicamente podría acceder (mitigar con controles y auditoría).
