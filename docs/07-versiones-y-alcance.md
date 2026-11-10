# Versiones y alcance — qué entra en cada versión

> Esta es la fuente de verdad sobre **qué entra y qué queda para después**. Cada punto del prompt original está mapeado en la matriz del §6; si algo no aparece ahí, es un hueco y hay que agregarlo.

## 1. Estrategia de versiones

| Versión | Nombre | Fases del roadmap | Usuarios | Meta |
|---|---|---|---|---|
| **V0** | Validación | Fase 0 | Vos | Decidir con datos; prototipo descartable |
| **V1** | Memoria personal | Fases 1, 2 (parcial), 3 (núcleo) | Vos + 3–5 invitados de confianza | Capturar ideas y reuniones, recuperar con citas, recibir conexiones útiles |
| **V2** | Asistente y clientes | Fase 2 (resto), 4 | Beta cerrada (10–30) | Acciones con aprobación + Customer Intelligence + reuniones en vivo |
| **V3** | Inteligencia colectiva | Fase 5 | Piloto cerrado | Compartir y colaborar entre memorias con consentimiento |
| **V4** | Empresa | Fase 6 | Organizaciones | Equipos, compliance, memoria comercial colectiva |
| **Futuro** | Exploratorio | — | — | Captura ambiental, apps desktop nativas, etc. |

Regla de corte: nada entra a V1 si no ayuda a responder "¿me devuelve algo valioso que no habría encontrado solo, con fuente verificable?".

## 2. V0 — Validación (2–3 semanas)
- Set dorado con tus reuniones e ideas reales (anonimizadas si hace falta).
- Prototipo descartable (scripts) de extracción + embeddings + 30 preguntas.
- Benchmarks: modelos de extracción, ASR en español rioplatense, embeddings.
- Dictamen legal inicial sobre grabación y datos de terceros.
- Modelo de costos.
- **Salida**: decisión go/no-go y ajuste de V1.

## 3. V1 — Memoria personal (lo que SÍ entra)

**Plataforma**
- Auth con passkeys/OIDC, workspace personal, esquema multi-tenant con RLS desde el día 1 (aunque haya un solo usuario real, soporta invitados aislados).
- Gateway multi-LLM (Claude + OpenAI + local vía Ollama opcional), enrutamiento por tarea, registro de costos, `data_class`.
- Observabilidad y evals automatizados.
- Cifrado en reposo y gestión de secretos.

**Captura**
- Web/PWA: texto, voz, subir documentos/URLs/archivos de audio.
- iOS nativa mínima: share sheet, widget, Action Button, dictado, subida en segundo plano, cola offline.
- Reuniones **por subida**: audio grabado (Notas de voz del iPhone, Zoom, etc.) o transcripción → procesamiento completo.
- Contexto básico opt-in: fecha/hora, dispositivo, app de origen; ubicación aproximada sólo si activás.

**Memoria**
- Modelo de entidades completo (thought, idea, concept, project, person, conversation, meeting, decision, task, event, source, relationship) con procedencia, `origin_kind`, estado epistémico, confianza, validación e historial.
- Resolución de entidades con bandeja de revisión (confirmar/corregir/rechazar).
- Búsqueda híbrida, chat con citas, memoria temporal, embeddings en 2 vistas.

**Reuniones**
- Transcripción con diarización, decisiones/tareas/ideas con autoría, enlace a memoria previa. Registro de consentimiento por reunión.

**Inteligencia**
- Conexiones explicadas (qué ideas, origen, por qué, novedad, incertidumbre), detección de contradicciones con decisiones, digest semanal, proactividad configurable (por defecto baja), feedback.
- Perfil dinámico personal (preferencias y estilo) con fuente y edición.

**Customer Intelligence mínimo (cuña)**
- Organizaciones/contactos como entidades con perfil de hechos `declared/observed/inferred` con fuente, confianza y corrección (categorías cerradas).
- **Borrador** de mail con contexto del cliente y tu estilo: se muestra o se abre como borrador; **no se envía automáticamente**.

**Control del usuario**
- Exportación completa, borrado con cascada, retención configurable, auditoría de accesos y de datos enviados a LLM.

**Aceptación de V1**: criterios de las Fases 1, 2 (sin grabación en vivo) y 3 de `03-roadmap.md`.

## 4. V2 — Asistente y clientes (queda para la segunda)
- Action Runtime completo (Intent → Plan → Preview → Aprobación → Ejecución → Auditoría) y conectores MCP: Gmail (enviar), Calendar, Drive.
- Defensa contra prompt injection con suite adversarial.
- Customer Intelligence completo: oportunidades, catálogo de precios y descuentos, propuestas con validación determinística de importes, `outcomes` y estadísticas descriptivas, objeciones/preguntas extraídas de conversaciones.
- Grabación de reuniones en vivo con consentimiento verificable (app/escritorio) e integraciones Meet/Zoom/Teams.
- Extensión de navegador.
- MindSync como servidor MCP (exponer tu memoria a otros clientes de IA).
- Contexto point-in-time ampliado (GPS puntual para consultas contextuales).
- BYOK y planes de uso.
- Reglas de automatización de bajo riesgo (con tope y kill-switch).
- Usuarios beta (10–30) con soporte y facturación inicial.

## 5. V3, V4 y Futuro
**V3 — Inteligencia colectiva**: `share_grants` (idea, proyecto), revocación con aviso de límites, workspaces colaborativos con autoría, broker de matching con anonimato hasta aceptación mutua, síntesis colaborativa, términos de IP, pentest externo.

**V4 — Empresa**: organizaciones, SSO/SAML/SCIM, roles y políticas, DLP, modelos permitidos por org, memoria comercial colectiva (cuentas y aprendizajes sin exponer memoria personal), claves por tenant/BYOK, residencia de datos, self-host/VPC, facturación y cuotas, SOC 2.

**Futuro / condicionado a evidencia**
- Captura ambiental continua (consentimiento, batería, legal, restricciones de iOS).
- Apps nativas de Windows/Linux (la PWA y la extensión cubren el caso hasta entonces).
- Modo local-first/E2EE para usuarios de alta privacidad.
- Auriculares/dispositivos de audio dedicados.
- Base de grafos o vector DB si se cumplen las condiciones del ADR-0003.

**Descartado por defecto (requiere reabrir decisión)**: inferencia de emociones, personalidad o intención de compra a partir de voz/video/gestos (D-12). Lo único que podría entrar es métricas objetivas de la conversación (turnos, tiempo de habla), opt-in.

## 6. Matriz de cobertura del prompt original

| Sección del prompt | Tema | Versión | Dónde se detalla |
|---|---|---|---|
| 2 | Visión, memoria del usuario, independencia de LLM | V1 | 01, ADR-0002/0007 |
| 3 | Principios 1–8 | V1 | 01, 02 |
| 3 | Principio 9 (conectar memorias) | V3 | 02 §5.1, Fase 5 |
| 3 | Principio 10 (escala personal/empresarial) | V1 (modelo) / V4 | ADR-0004 |
| 4.1 | Pensamientos, voz, texto | V1 | E2 |
| 4.1 | Conversaciones con asistentes de IA (importar) | V1 (importación de exportaciones/pegado) | E2 + importadores |
| 4.1 | Compartir desde otras apps | V1 (iOS share sheet) | E7 |
| 4.1 | Documentos, archivos, web | V1 (subida/URL) / V2 (extensión) | E2, E7 |
| 4.2 | Hora, dispositivo, app de origen | V1 | E7.4 |
| 4.2 | GPS | V1 puntual opt-in aproximado / V2 consultas contextuales / Futuro continuo | E7.4 |
| 4.2 | Actividad, apps y documentos autorizados, contexto de trabajo | V2 | conectores MCP |
| 4.2 | Dispositivos conectados | Futuro | — |
| 4.2 | Ejemplo kiosco cercano | V2 | herramienta de lugares (lectura) |
| 4.3 | Reuniones por subida con diarización, ideas, tareas, autoría | V1 | E8 |
| 4.3 | Grabación en vivo con autorización | V2 | E8.2 |
| 5 | Modelo de conocimiento y campos obligatorios | V1 | 02 §4, ADR-0002 |
| 5 | Distinción propio/ajeno/hipótesis/decisión/IA | V1 | ADR-0002 |
| 6 | Híbrido, RAG, temporal, largo plazo | V1 | 02 §3 |
| 6 | Multi-vector | V1 (2 vistas) | 02 §3.4 |
| 6 | Evaluar vector DB / grafos | Revisión en V2/V3 | ADR-0003 |
| 7A–C | Comprender, relacionar, evolucionar sin entrenar | V1 | E3, E10 |
| 7D | Generar ideas explicadas | V1 | E9 |
| 7E | Proactividad configurable | V1 (digest + alertas de contradicción) / V2 (ampliada) | E9 |
| 8 | Intención → acción, estilo del usuario | V1 borrador / V2 ejecución | E10, E11 |
| 8 | Permisos, confirmaciones, auditoría | V1 (auditoría) / V2 (runtime completo) | E11 |
| 9 niveles 1–2 | Privado / idea puntual | V1 privado, V3 idea puntual | ADR-0004 |
| 9 niveles 3–4 | Proyecto / espacios colaborativos | V3 | E13 |
| 9 niveles 5–6 | Inter-org / colectivo empresarial | V4 | E14 |
| 9 | Consentimiento y revocación | V3 | 06 §6 |
| 10 | Multi-LLM y enrutamiento | V1 | ADR-0007 |
| 10 | Modelos locales | V1 opcional | ADR-0007/0008 |
| 10 | Multiagente vs orquestador | V1 orquestador; multiagente V3 si hace falta | ADR-0005 |
| 10 | MCP | V2 | E11 |
| 11 | iPhone | V1 | E7 |
| 11 | Web | V1 | E7 |
| 11 | Navegador | V2 | E7.3 |
| 11 | Windows/Linux | V1 vía web; nativo Futuro | — |
| 11 | Auriculares/dispositivos | Futuro | — |
| 11 | Widgets, accesos rápidos, dictado, segundo plano, sync | V1 | E7 |
| 11 | Captura ambiental continua | Futuro | — |
| 12 | Aislamiento, auth, authz, cifrado, auditoría | V1 | 06, ADR-0004/0006 |
| 12 | Consentimiento, eliminación, exportación, retención | V1 | E6 |
| 12 | Implicancias legales de reuniones y terceros | V0 (dictamen) → V2 (en vivo) | 06 |
| 12 | Separación personal/empresarial | V1 (modelo) / V4 | ADR-0004 |
| 13 | B2C | V2 | D-10 |
| 13 | B2B | V4 | D-10 |
| 13 | Colectivo | V3 | D-10 |
| 14 | Entregables 1–5 | hecho (v0.1) | 01–05 |
| 15 | ADRs y carpeta /docs | hecho | adr/ |
| 16.1 | Captura de conversaciones, necesidades, objeciones | V1 básica / V2 completa | E12.6 |
| 16.1 | Señales de voz/video | Descartado (D-12); métricas objetivas Futuro | D-12 |
| 16.1 | Observación vs inferencia | V1 | ADR-0002 |
| 16.2 | Perfil dinámico de cliente | V1 básico / V2 completo | E12.2 |
| 16.3 | Propuestas adaptadas, precios autorizados | V1 borrador de mail sin importes / V2 propuestas con catálogo | E12.3–12.4 |
| 16.4 | Aprendizaje comercial | V2 (descriptivo) | E12.5 |
| 16.5 | Asistente de ventas (8 pasos) | V1 hasta el paso 4 y 7 (borrador) / V2 completo con aprobación y envío | E12 |
| 16.6 | Inteligencia comercial colectiva | V4 | E14.3 |
| 16.7 | Consideraciones legales/técnicas | V0 → todas | 06 |
| 16.8 | Qué es MVP y qué enterprise | este documento | 07 |

## 7. Orden de trabajo inmediato (próximos pasos)
1. Armar repo (monorepo: `apps/api`, `apps/web`, `apps/ios`, `packages/core`, `docs/`) y Docker Compose.
2. Tú: pasar 5–10 reuniones/ideas reales para el set dorado (V0).
3. Escribir el esquema SQL (entidades, procedencia, RLS) y los tests de aislamiento.
4. Prototipo de ingestión con una reunión real de punta a punta.
5. Revisar resultados y fijar el alcance final de V1.
