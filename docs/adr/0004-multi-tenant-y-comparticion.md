# ADR-0004 — Workspaces con RLS; compartir mediante grants explícitos, nunca acceso directo

- Estado: **Propuesto**
- Fecha: 2026-11-10

## Contexto
La plataforma debe soportar memoria personal, espacios de cliente, equipos y organizaciones, con compartición granular y revocable. "Compartir una idea" no puede implicar acceso a toda la memoria.

## Decisión
1. Unidad de aislamiento: **workspace** (`personal`, `client`, `team`, `org`), perteneciente a un tenant.
2. Toda tabla de datos tiene `workspace_id`; RLS en PostgreSQL con `app.user_id` y `app.workspace_ids` seteados por request. Sin política → sin acceso.
3. Nada entre workspaces fluye salvo un **`share_grant`**: `{grantor, destino, alcance (entidades/proyecto), permisos (read|derive|quote), propósito, expiración, revocación, consentimiento}`.
4. El receptor accede a un **objeto compartido** (snapshot o vínculo con versión) dentro de su workspace, no a la memoria del emisor.
5. Los agentes/consultas de un usuario operan con la identidad y los permisos de ese usuario. No existe una "cuenta de servicio" con acceso transversal en tiempo de consulta, salvo el broker de matching (Fase 5), que sólo ve entidades `discoverable`.
6. Cada derivado generado a partir de material compartido hereda la restricción (`derived_from` + `data_class`) y queda sujeto a revocación.
7. Datos de organizaciones están en workspaces `org` con propietario org; el espacio personal del empleado es inaccesible para la org.

## Reglas de implementación (agregadas tras la revisión de seguridad, ver `08-revision-seguridad-aislamiento.md`)
8. App y workers usan roles sin `BYPASSRLS`; todas las tablas de datos con `FORCE ROW LEVEL SECURITY`.
9. El contexto de tenant se fija con `set_config('app.user_id', ..., true)` dentro de cada transacción; sin contexto → sin filas.
10. Solo `app.user_id` viene del request; la pertenencia a workspaces se resuelve en la DB vía `memberships`.
11. PK y FK compuestas `(workspace_id, id)`; ningún vínculo directo entre workspaces.
12. Todo derivado registra `derived_from_grants`; revocar borra o redacta esos derivados.
13. Una sesión de agente opera sobre un solo workspace; mover contenido entre workspaces es siempre una acción explícita del usuario.

## Alternativas
- Una base/esquema por tenant: máximo aislamiento, más costo operativo; reservar para clientes enterprise que lo exijan.
- Aislamiento solo en capa de aplicación: propenso a errores; rechazado como único control.
- Acceso federado entre memorias (consulta en vivo a otra memoria): difícil de auditar y revocar; rechazado.

## Consecuencias
+ Revocación y auditoría tratables; modelo coherente de niveles 1–6.
− Complejidad de políticas RLS y de rendimiento (índices por `workspace_id`); hay que probar el aislamiento continuamente.
− La revocación no puede "des-ver" lo ya visto; debe comunicarse al usuario.
