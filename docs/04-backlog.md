# Entregable 4 — Backlog técnico

Prioridad: **P0** bloquea todo / **P1** valor núcleo del MVP / **P2** valor alto, no bloqueante / **P3** posterior.
Tamaño: S (<2 d), M (2–5 d), L (1–2 sem), XL (>2 sem; partir antes de comenzar).
Las épicas se ordenan por dependencia; `→` indica dependencia.

## Épica E0 — Fundaciones y validación (Fase 0) · P0
- US-0.1 Como fundador, quiero un set dorado de preguntas y conexiones esperadas para medir calidad objetivamente.
  - T: recopilar 100 notas/transcripciones reales (anonimizar) [M]; escribir 30 preguntas + respuestas esperadas con fuente [M]; 20 pares de conexiones [M]; script de evaluación [M].
- US-0.2 Quiero comparar modelos (extracción, embeddings, ASR) para elegir con datos.
  - T: harness de evals reproducible [M]; benchmarks y tabla costo/calidad [M].
- US-0.3 Quiero un dictamen legal inicial sobre grabar reuniones y procesar datos de terceros.
  - T: checklist por jurisdicción [M]; texto de consentimiento v0 [S].
- US-0.4 Quiero un modelo de costos por usuario. T: planilla con 3 escenarios [S].
- US-0.5 Quiero decidir stack y cerrar ADRs 0001–0007. T: spike de 2 días por opción dudosa [M].

## Épica E1 — Plataforma base · P0 (→ E0)
- US-1.1 Como usuario, quiero registrarme/iniciar sesión de forma segura (passkeys/OIDC).
  - T: auth + sesiones [M]; modelo `users/tenants/workspaces/memberships` [M].
- US-1.2 Como desarrollador, quiero RLS por workspace para que el aislamiento no dependa del código de aplicación.
  - T: políticas RLS + contexto de sesión por request [L]; suite de tests de aislamiento en CI [M].
  - T (de la revisión de seguridad): roles `ms_migrator/ms_app/ms_worker` sin BYPASSRLS + `FORCE RLS` [S]; wrapper `withTenant` con `set_config(..., true)` y regla de lint [M]; función `ms_user_workspaces()` SECURITY DEFINER [S]; PK/FK compuestas `(workspace_id, id)` [M]; check de catálogo en CI [S]; test de fuga de contexto entre conexiones del pool [S]; jobs con `workspace_id` + `acting_user_id` [S]; claves de caché con workspace [S]; auditoría INSERT-only con hash encadenado [M]; logs sin contenido [S].
- US-1.6 Como operador, quiero un acceso de soporte break-glass con motivo, expiración y auditoría visible para el usuario [M]. · P2
- US-1.3 Quiero observabilidad (logs, trazas, coste LLM por llamada). T: OpenTelemetry + tabla `llm_calls` [M].
- US-1.4 Quiero migraciones, entornos y CI/CD. T: infra como código mínima, Docker Compose dev [M].
- US-1.5 Quiero cifrado en reposo y gestión de secretos. T: KMS/envelope por tenant (diseño + versión simple) [M].

## Épica E2 — Captura y fuentes · P1 (→ E1)
- US-2.1 Capturar texto en <5 s. T: endpoint + UI mínima + atajo de teclado [M].
- US-2.2 Capturar voz y transcribirla. T: grabación en navegador [M]; subida resumible [M]; job de ASR [M].
- US-2.3 Subir documentos/URLs. T: parser PDF/HTML/MD [M]; extracción de texto limpio [M].
- US-2.4 Conservar la fuente inmutable con hash y metadatos de contexto. T: object storage + tabla `sources` [M].
- US-2.5 Registrar consentimiento asociado a una fuente cuando haya terceros. T: modelo `consent_records` [M].

## Épica E3 — Ingestión y modelo de conocimiento · P1 (→ E2)
- US-3.1 Que el sistema extraiga ideas, tareas, personas, decisiones, proyectos de una captura.
  - T: esquemas JSON de extracción [M]; prompts + validación + reintentos [L]; evals contra set dorado [M].
- US-3.2 Resolución de entidades (¿misma persona/proyecto?). T: matching por embeddings+heurísticas, cola de ambigüedades [L].
- US-3.3 Procedencia completa. T: tabla `provenance` con cita/offset, `origin_kind`, `epistemic_status` [M].
- US-3.4 Historial de evolución por entidad. T: `entity_history` + diff [M].
- US-3.5 Reprocesar fuentes sin pisar correcciones del usuario. T: reglas de precedencia + tests [M].
- US-3.6 Bandeja de revisión (confirmar/corregir/rechazar). T: UI + endpoints [L].

## Épica E4 — Recuperación y chat con citas · P1 (→ E3)
- US-4.1 Búsqueda híbrida (vector + texto + filtros + tiempo). T: índices HNSW/GIN [M]; fusión RRF [M]; benchmark de latencia [S].
- US-4.2 Expansión por relaciones (1–2 saltos). T: consultas recursivas [M].
- US-4.3 Chat con respuestas citadas y navegables a la fuente. T: composición de contexto con presupuesto de tokens [M]; verificación de citas existentes [M].
- US-4.4 Memoria temporal ("¿qué pensaba sobre X en marzo?"). T: filtros `valid_from/to`, lenguaje temporal [M].
- US-4.5 Embeddings multi-vista (literal + abstracto). T: tabla `embeddings(aspect, model)`, re-embedding job [M].

## Épica E5 — Gateway multi-LLM · P1 (→ E1; paralelo a E3)
- US-5.1 Interfaz única de proveedores. T: adaptadores Claude, OpenAI, local (Ollama) [L].
- US-5.2 Enrutamiento por tarea configurable. T: tabla de políticas + fallback [M].
- US-5.3 Políticas por clase de dato. T: `data_class`, reglas de bloqueo por proveedor [M].
- US-5.4 Control de gasto. T: presupuestos por usuario, caché, métricas [M].
- US-5.5 BYOK (clave propia del usuario). T: almacenamiento cifrado de claves [M]. · P2

## Épica E6 — Control del usuario y privacidad · P1 (→ E3)
- US-6.1 Exportar toda mi memoria (JSON/Markdown + archivos). T: exportador completo + formato documentado [L].
- US-6.2 Borrar una fuente/entidad con cascada de derivados, embeddings y archivos. T: borrado + verificación [L].
- ✅ US-6.5 (hecho 2026-11-10) Borrar mi cuenta completa (derecho de supresión). Antes era imposible: `workspaces.created_by`, `sources.owner_id` y `entities.owner_id` referencian al usuario sin cascada. T: definir qué se borra y qué se transfiere, cascada o función `ms_delete_account`, borrar archivos y claves, test de que no queda nada [L]. · **P1, antes de abrir a otros usuarios**
- US-6.3 Retención configurable. T: políticas y job de expiración [M]. · P2
- US-6.4 Auditoría de accesos y de datos enviados a LLM. T: log append-only [M].

## Épica E7 — Clientes móviles y captura de baja fricción · P1/P2 (→ E2)
- US-7.1 PWA instalable con captura offline. T: service worker + outbox [L].
- US-7.2 iOS: share sheet + widget + Action Button + dictado. T: app SwiftUI mínima [XL → partir]; subida en segundo plano [L]; App Intents [M].
- US-7.3 Extensión de navegador. T: guardar selección/página [M]. · P2
- US-7.4 Contexto point-in-time opt-in. T: permisos, precisión reducida, UI de control [M]. · P2

## Épica E8 — Reuniones · P1/P2 (→ E3, E7)
- US-8.1 Subir audio/transcripción de reunión y extraer decisiones/tareas/ideas con autoría. T: diarización [M]; etiquetado de hablantes manual o desde el calendario, **sin huellas de voz** [M]; declaración de consentimiento obligatoria al subir [S]; extracción por hablante [L]; revisión [M].
- US-8.2 Grabar con consentimiento verificable. T: flujo de consentimiento, aviso visible, bloqueo duro sin consentimiento [L]. · P2
- US-8.3 Relacionar lo dicho con memoria previa. T: job post-reunión [M].
- US-8.4 Integraciones con Meet/Zoom/Teams. T: investigación de APIs y bots [L]. · P3

## Épica E9 — Insight Engine y proactividad · P2 (→ E4, volumen de datos)
- US-9.1 Detectar conexiones con explicación estructurada (qué, origen, por qué, novedad, incertidumbre). T: candidatos por vecinos [M]; verificación LLM [L]; formato de explicación [M].
- US-9.2 Detectar contradicciones con decisiones. T: comparación decisión↔afirmación nueva [L].
- US-9.3 Proactividad configurable. T: reglas, umbrales, presupuesto de notificaciones, silencios [L].
- US-9.4 Feedback y calibración. T: eventos 👍/👎, tuning de umbrales, panel de precisión [M].
- US-9.5 Digest semanal. T: job + plantilla [M].

## Épica E10 — Perfil dinámico personal · P2 (→ E9)
- US-10.1 Hechos de perfil con fuente, confianza y validez temporal; editables. T: `profile_facts` + UI [L].
- US-10.2 Estilo de escritura por few-shot. T: banco de ejemplos aprobados [M].

## Épica E11 — Action Runtime y MCP · P1 de Fase 4 (→ E10, E6.4)
- US-11.1 Registro de herramientas con clasificación de efecto. T: esquema, clasificación, políticas [M].
- US-11.2 Ciclo Intent→Plan→Preview→Aprobación→Ejecución→Auditoría. T: motor de estados [L]; UI de aprobación [M]; auditoría inmutable [M].
- US-11.3 Cliente MCP + conectores Gmail, Calendar, Drive con scopes mínimos. T: OAuth [L]; borrador-sin-enviar primero [M].
- US-11.4 Defensa contra prompt injection. T: separación instrucción/dato, etiquetado de contenido no confiable, suite adversarial [L].
- US-11.5 MindSync como servidor MCP (exponer memoria a otros clientes). T: servidor de solo lectura con auth y permisos [L]. · P2
- US-11.6 Reglas de automatización de bajo riesgo. T: reglas, topes, kill-switch [M]. · P3

## Épica E12 — Customer Intelligence · P2 (→ E3, E11)
- US-12.1 Gestionar organizaciones, contactos y oportunidades vinculados a la memoria. T: modelo + UI [L].
- US-12.2 Perfil de cliente con hechos `declared/observed/inferred`, fuente, confianza, corrección. T: categorías cerradas, validaciones del esquema [L].
- US-12.3 Catálogo de precios y políticas de descuento autorizados. T: importación CSV, versionado [M].
- US-12.4 Generar propuesta y mail adaptados al cliente, con aprobación. T: plantilla + ensamblado desde catálogo [L]; validador determinístico de importes [M]; borrador en estilo del usuario [M].
- US-12.5 Registrar resultados y ver estadísticas descriptivas con tamaño de muestra. T: `outcomes`, vistas [M]. · P3
- US-12.6 Hechos observados de conversación (objeciones, preguntas) con evidencia. T: extractor específico [L].
- US-12.7 Señales de voz/video. **No planificado** (ver decisión D-12).

## Épica E13 — Compartir e inteligencia colectiva · P3 (→ E1.2, auditoría de seguridad)
- US-13.1 Compartir una idea con una persona con alcance, permisos y expiración. T: `share_grants`, UI de consentimiento [L].
- US-13.2 Revocar acceso y ver qué cambia. T: revocación + derivados + aviso de límites [L].
- US-13.3 Workspaces colaborativos con autoría. T: membresía, roles, atribución [L].
- US-13.4 Broker de matching sobre entidades discoverable, con anonimato hasta aceptar. T: indexación aislada [XL → partir]; protocolo de encuentro [L]; salvaguardas anti-inferencia [L].
- US-13.5 Síntesis colaborativa con atribución. T: orquestación restringida al material aportado [L].
- US-13.6 Términos de IP y autoría. T: revisión legal [M].

## Épica E14 — Empresa · P3 (→ E13 parcial)
- US-14.1 Orgs, roles, SSO/SAML, SCIM. [XL → partir]
- US-14.2 Políticas de retención, modelos permitidos, DLP. [L]
- US-14.3 Memoria comercial colectiva sin exponer memoria personal. [XL]
- US-14.4 Claves por tenant (BYOK/KMS), residencia de datos, self-host. [XL]
- US-14.5 Facturación y cuotas. [L]

---

## Orden sugerido de ejecución (camino crítico)

1. E0 → E1 (auth, RLS, observabilidad)
2. E5 (gateway) ∥ E2 (captura) → E3 (ingestión) → E4 (recuperación y chat)
3. E6 (export/borrado) — antes de abrir a otros usuarios
4. E7 (PWA/iOS) → E8 (reuniones)
5. E9 (insights) → E10 (perfil)
6. E11 (acciones) → E12 (Customer Intelligence)
7. E13 (colectivo) → E14 (empresa)

**Por qué E6 temprano**: export/borrado son difíciles de añadir después y son parte de la promesa de propiedad.
**Por qué E12 después de E11**: Customer Intelligence sin acciones es un CRM más; el valor está en preparar y enviar con contexto.
