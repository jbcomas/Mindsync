# Privacidad, seguridad y consideraciones legales

> Esto es análisis técnico-producto, **no asesoramiento legal**. Requiere validación con un abogado local antes de la Fase 2 (grabación de reuniones) y la Fase 4 (datos de terceros).

## 1. Principios
1. Minimizar: capturar y enviar al LLM sólo lo necesario.
2. Consentimiento explícito, registrado y revocable.
3. Procedencia y trazabilidad de toda inferencia.
4. El usuario puede ver, corregir, exportar y borrar.
5. Separación estricta entre espacios (personal / cliente / empresa).
6. Seguro por defecto: deny-by-default, aprobación humana para acciones.

## 2. Grabación de reuniones
- Las reglas varían: en muchas jurisdicciones basta el consentimiento de una parte; en otras (varios estados de EE. UU., y en la UE en la práctica por protección de datos) se necesita el de todos. Hay que verificar Argentina (Ley 25.326, Código Penal sobre comunicaciones), UE (GDPR, ePrivacy), Brasil (LGPD).
- **Política de producto propuesta (la más estricta)**: aviso y consentimiento de todos los participantes antes de grabar; indicador visible durante la grabación; bloqueo duro si no hay consentimiento registrado; el anfitrión no puede omitirlo.
- Registro `consent_records`: quién, cuándo, alcance (grabar, transcribir, usar para IA, compartir con equipo), fecha de expiración.
- Participante puede pedir exclusión/borrado de sus intervenciones.
- Reuniones presenciales: grabar sólo en primer plano, con anuncio verbal registrado.

## 3. Datos de terceros (clientes, contactos)
- Base legal para tratarlos (interés legítimo o ejecución de contrato; consentimiento cuando corresponda). Evaluar necesidad de DPIA/EIPD en contextos de perfilado.
- Derechos de acceso, rectificación y supresión también para terceros: debe existir un procedimiento y la posibilidad técnica de localizar todo lo relativo a una persona (`person` + provenance).
- Si el usuario es empleado de una empresa, los datos de clientes pueden ser de la empresa, no personales: modelar **propiedad del dato** (`owner_scope`) y evitar que la memoria personal absorba datos corporativos sin permiso.

## 4. Datos sensibles y perfilado
- Categorías especiales (salud, origen, opiniones políticas, biometría, etc.): no inferir ni almacenar; detectar y descartar/marcar.
- Customer Intelligence: lista **cerrada** de categorías de perfil comercial. Nada de rasgos de personalidad ni emociones.
- Voz/video: no se extraen señales emocionales (ver D-12). El AI Act de la UE prohíbe sistemas de reconocimiento de emociones en el lugar de trabajo; la voz y el rostro pueden ser datos biométricos.
- Decisiones automatizadas con efectos significativos sobre personas (GDPR art. 22): MindSync sugiere, no decide.
- **Observación vs inferencia**: se almacenan en estructuras distintas, con confianza y evidencia; las inferencias son siempre rechazables.

## 5. Seguridad técnica
| Área | Control |
|---|---|
| Identidad | Passkeys/OIDC, MFA en org, sesiones cortas |
| Autorización | RBAC por workspace + ABAC por `data_class` + `share_grants`; RLS en DB |
| Aislamiento | `workspace_id` en cada fila; tests de aislamiento en CI; secretos por tenant |
| Cifrado | TLS 1.2+; reposo con claves por tenant (envelope); audio en bucket privado con URLs firmadas efímeras |
| Auditoría | Registro append-only: lecturas sensibles, grants, acciones, datos enviados a LLM |
| LLM | Acuerdos de no entrenamiento/no retención; `data_class` restringe proveedores; opción de modelo local |
| Prompt injection | Contenido recuperado = no confiable; no puede originar acciones; aprobación humana |
| Retención | Políticas configurables; borrado en cascada (derivados, embeddings, archivos); backups con ventana documentada |
| Respuesta a incidentes | Plan, notificación (GDPR 72 h), inventario de datos |

## 6. Inteligencia colectiva: riesgos específicos
- **Inferencia por embeddings**: un vector puede revelar contenido; compartir representaciones equivale a compartir contenido. Sólo se exponen resúmenes aprobados por el titular.
- **Compartir una idea ≠ compartir la memoria**: los grants están acotados a entidades concretas y a permisos (`read/derive/quote`). Nunca acceso a la base completa.
- **Revocación**: se puede cortar el acceso futuro y eliminar derivados no consolidados; no se puede garantizar que la persona "olvide" lo ya visto. Se informa antes de compartir.
- **Autoría e IP**: cada aporte conserva autor y fecha; términos explícitos sobre ideas combinadas (D-14).
- **Confidencialidad entre organizaciones**: acuerdos entre partes; el broker no ve más de lo que cada parte marcó `discoverable`.

## 7. Entre memoria personal y empresarial
- Workspaces separados con propietarios distintos. Nada fluye de uno a otro sin un `share_grant` explícito del propietario del dato.
- Al dejar una empresa: lo corporativo queda en la org, lo personal se exporta; dato mixto → regla definida por contrato.
- La org no puede ver el workspace personal de un empleado, aunque sea el mismo usuario.

## 8. Lista de verificación previa a cada fase
- [ ] Fase 1: export y borrado funcionan; RLS probada.
- [ ] Fase 2: consentimiento de grabación revisado por abogado; política de retención de audio.
- [ ] Fase 4: base legal para datos de terceros; scopes OAuth mínimos; pruebas de injection.
- [ ] Fase 5: pentest, términos de IP, moderación/abuso.
- [ ] Fase 6: DPA, subprocesadores, residencia de datos, SOC 2.
