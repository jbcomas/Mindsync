# Entregable 3 — Roadmap

> Las estimaciones asumen 1–2 desarrolladores + asistencia de IA. Son órdenes de magnitud, no compromisos. Cada fase termina en algo **usable**, y no se pasa de fase sin cumplir sus criterios de aceptación.

## Resumen

| Fase | Foco | Duración orient. | Resultado usable |
|---|---|---|---|
| 0 | Investigación y validación | 2–3 sem | Decisiones clave tomadas, prototipos descartables, evals base |
| 1 | Motor de memoria (MVP núcleo) | 6–8 sem | Capturar, buscar, chatear con citas |
| 2 | Captura contextual y reuniones | 6–8 sem | iOS rápido, reuniones → conocimiento |
| 3 | Inteligencia relacional | 6–8 sem | Conexiones e ideas explicadas; proactividad configurable |
| 4 | Asistente y acciones + Customer Intelligence base | 8–10 sem | Mails/propuestas con aprobación, perfil de cliente |
| 5 | Inteligencia colectiva | 10–14 sem | Compartir y colaborar entre usuarios con consentimiento |
| 6 | Producto empresarial | 12+ sem | Orgs, roles, compliance, memoria comercial colectiva |

---

## Fase 0 — Investigación y validación

**Funcionalidades / actividades**
- Prototipo descartable: 50–100 notas/transcripciones reales tuyas → extracción + embeddings + 30 preguntas de prueba. Mide si la recuperación y las conexiones aportan valor.
- Benchmarks: 2–3 modelos de extracción, 2 ASR (con diarización), 2 modelos de embeddings (idioma español).
- Entrevistas: 8–10 personas (vendedores, consultores, fundadores) sobre captura, grabación de reuniones y compartir memoria.
- Revisión legal inicial: grabación de reuniones (Argentina/LatAm/UE), protección de datos (Ley 25.326 AR, GDPR, LGPD), alcance del AI Act.
- Cierre de decisiones D-01…D-08 (ver `05-open-decisions.md`).
- Modelo de costos por usuario/mes.

**Dependencias**: ninguna.
**Riesgos**: sesgo de dogfooding (sos el único usuario); entusiasmo en lugar de evidencia.
**Criterios de aceptación**
- Set dorado de ≥30 preguntas + ≥20 pares de conexiones esperadas creado.
- Recuperación con cita correcta ≥70 % en prototipo (baseline).
- ADRs 0001–0007 aceptados; stack elegido.
- Costo estimado por usuario activo calculado con 3 escenarios.
- ≥5 entrevistas con insight accionable; decisión go/no-go documentada.

## Fase 1 — Motor de memoria

**Funcionalidades**
- Auth + workspace personal; esquema con `workspace_id` y RLS desde el día 1.
- Captura por texto y voz (web/PWA); almacenamiento inmutable de fuentes.
- Pipeline de ingestión (cola, transcripción, extracción, embeddings, resolución básica de entidades).
- Modelo de entidades con procedencia, `origin_kind`, confianza, validación, historial.
- Búsqueda híbrida + chat con citas navegables a la fuente.
- Gateway multi-LLM con 2 proveedores + routing por tarea + registro de costos.
- Bandeja de revisión: confirmar/corregir/rechazar lo extraído.
- Exportar todo; borrar fuente con cascada.

**Dependencias**: Fase 0.
**Riesgos**: extracción ruidosa que ensucia la memoria; deriva de alcance; costos.
**Criterios de aceptación**
- ≥80 % de las 30 preguntas del set dorado responden con cita correcta.
- Captura→disponible para búsqueda <60 s (p95) para texto.
- Test automatizado de aislamiento: un usuario B no accede a nada de A (todas las tablas/endpoints).
- Hallazgos C-1, C-2, C-3, A-1, A-2, A-3, A-4, A-7 y A-8 de `08-revision-seguridad-aislamiento.md` implementados, y su checklist (§6) en verde en CI **antes de invitar a cualquier otro usuario**.
- Textos de consentimiento de `legal/consentimientos-v0.md` §2–§3 revisados por abogado.
- Re-procesar una fuente es idempotente y respeta las correcciones del usuario.
- Exportación e eliminación verificadas end-to-end (incluye vectores y archivos).

## Fase 2 — Captura contextual y reuniones

**Funcionalidades**
- App iOS mínima: share sheet, widget/Action Button, dictado con subida en segundo plano, cola offline.
- Extensión de navegador (guardar selección/página).
- Contexto point-in-time opt-in (hora, ubicación aproximada, app de origen).
- Reuniones: subir audio/transcripción; luego grabación con consentimiento registrado; transcripción con diarización; extracción de decisiones, tareas, ideas con autoría (`asserted_by`); enlace a memoria previa.
- Consulta contextual simple ("¿kiosco cercano?") vía herramienta de lugares (lectura).

**Dependencias**: Fase 1 (ingestión, procedencia).
**Riesgos**: restricciones de iOS (background audio), precisión de diarización, consentimiento/legalidad, batería.
**Criterios de aceptación**
- Captura por voz desde pantalla bloqueada/Action Button en ≤3 toques y <10 s medianos.
- Reunión de 60 min procesada <15 min; ≥90 % de decisiones/tareas relevantes detectadas en set de prueba (revisadas a mano); atribución de hablante correcta ≥85 % en audio de prueba.
- Sin grabación posible sin registro de consentimiento (bloqueo duro).
- Autonomía de batería medida y documentada.

## Fase 3 — Inteligencia relacional

**Funcionalidades**
- Detección de conexiones (embeddings abstractos + grafo + verificación por LLM) con explicación: qué ideas, origen, por qué, nueva posibilidad, incertidumbre.
- Detección de contradicciones con decisiones previas.
- Digest/ideas semanales; proactividad configurable (frecuencia, canales, umbrales, temas silenciados).
- Feedback de utilidad → ajuste de umbrales y ranking.
- Perfil dinámico personal (preferencias/estilo, con fuente y edición).

**Dependencias**: Fase 1–2 (volumen de memoria suficiente).
**Riesgos**: falsos positivos/ruido → pérdida de confianza; alucinaciones en las "nuevas ideas"; costo de cómputo cuadrático.
**Criterios de aceptación**
- ≥40 % de las conexiones mostradas marcadas "útil" por el usuario durante 4 semanas; <3 notificaciones/día por defecto.
- 100 % de las sugerencias incluyen fuentes verificables; ninguna cita inexistente (test automatizado).
- Detección de contradicciones: precisión ≥70 % en set etiquetado.
- Costo mensual de jobs dentro del presupuesto fijado en Fase 0.

## Fase 4 — Asistente personal, acciones y Customer Intelligence base

**Funcionalidades**
- Action Runtime: permisos, previews, aprobación, auditoría; conectores MCP: Gmail (borrador/enviar), Calendar, Drive.
- Resolución de intención con desambiguación; redacción en estilo del usuario (few-shot desde mails aprobados).
- Módulo Customer Intelligence MVP: organizaciones/contactos/oportunidades, perfil con hechos `declared/observed/inferred` con fuente y corrección; catálogo de precios autorizados; borrador de propuesta + mail con validación determinística de importes.
- Registro de resultados (`outcomes`) y estadísticas descriptivas.
- Protección contra prompt injection: pruebas adversariales.

**Dependencias**: Fases 1–3; decisión legal sobre datos de terceros.
**Riesgos**: acciones erróneas/irreversibles; inyección vía contenido; OAuth scopes excesivos; datos de terceros sin base legal.
**Criterios de aceptación**
- 0 envíos sin aprobación explícita (test + auditoría).
- Suite adversarial de injection: 0 acciones disparadas por contenido no confiable.
- Propuestas: 100 % de importes coinciden con el catálogo; desviaciones bloquean el envío.
- ≥70 % de borradores enviados con edición menor (medido por distancia de edición).
- Log de auditoría completo y consultable para toda acción.

## Fase 5 — Inteligencia colectiva

**Funcionalidades**
- `share_grants`: compartir idea / proyecto con alcance, permisos, expiración, revocación.
- Workspaces colaborativos con autoría por aporte.
- Broker de matching sobre entidades *discoverable*, encuentros anónimos hasta aceptación mutua.
- Síntesis colaborativa limitada al material aportado, con atribución.
- Piloto cerrado de 10–30 usuarios.

**Dependencias**: Fase 3–4; revisión de seguridad externa; términos de uso y de IP.
**Riesgos**: fuga por inferencia; cold start; disputas de autoría; abuso/spam; confidencialidad inter-org.
**Criterios de aceptación**
- Pentest/revisión de aislamiento aprobados; ningún test de fuga cruzada falla.
- Revocación efectiva: tras revocar, el receptor no puede recuperar el contenido por consulta (verificado); aviso claro sobre límites.
- Al menos N (a definir, p.ej. 5) colaboraciones reales con ≥1 resultado que ambas partes califican como valioso.
- Atribución visible y exportable en 100 % de aportes.

## Fase 6 — Producto empresarial

**Funcionalidades**
- Organizaciones, SSO/SAML/SCIM, roles, políticas de retención y de modelos permitidos, DLP básico.
- Memoria comercial colectiva (aprendizajes y cuentas compartidas por equipo) sin exponer memoria personal.
- Consola admin, auditoría exportable, claves por tenant (BYOK/KMS), residencia de datos, despliegue self-host/VPC.
- Facturación (asientos, consumo), cuotas y límites.
- Certificaciones (SOC 2 Type I → II; ISO 27001) según demanda.

**Dependencias**: Fase 5 (o parcialmente 4 si se prioriza B2B), clientes de diseño.
**Riesgos**: ciclos de venta largos, requisitos de compliance, soporte on-prem.
**Criterios de aceptación**
- ≥3 clientes piloto pagos; separación personal/empresa verificada por auditoría externa.
- SLA y backups/restauración probados; export/borrado a nivel org.
- Informe de pruebas de aislamiento multi-org.

---

## Qué NO hacer pronto (explícito)

Captura ambiental continua · análisis de emociones/gestos · multiagente autónomo sin aprobación · app nativa Windows/Linux · vector DB o graph DB separada · fine-tuning de modelos.
