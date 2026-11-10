# Entregable 5 — Decisiones pendientes

Cada decisión: opciones, ventajas/desventajas y **recomendación provisoria** (no certeza). Las marcadas ⏱ deben cerrarse antes de escribir código de Fase 1.

## Estado de resolución (2026-11-10)
- **Resueltas**: D-03 (TypeScript, ver ADR-0008), D-04 (web/PWA + iOS nativa mínima en Swift; hay Mac), D-01 (dogfooding con tus ideas y reuniones reales).
- **Siguen abiertas**: D-02, D-05 a D-18. Las ⏱ que quedan (D-02, D-06, D-09) se cierran en V0.
- Alcance por versión: ver [07-versiones-y-alcance.md](07-versiones-y-alcance.md).

## D-01 ⏱ ¿Cuál es el primer usuario y problema a validar? — RESUELTA: dogfooding
| Opción | + | − |
|---|---|---|
| A. Vos (dogfooding) como profesional independiente | Feedback inmediato, sin burocracia | Sesgo; no valida mercado |
| B. Vendedores/consultores (Customer Intelligence primero) | Camino claro a ingresos | Compite con CRMs; más legal desde el día 1 |
| C. Un grupo cerrado de 5–10 conocidos | Valida compartir y reuniones | Más soporte |

**Recomendación**: A en Fase 1–2, C en Fase 3 (antes de construir Fase 5), con B como cuña comercial en Fase 4.

## D-02 ⏱ ¿Cloud, local-first o híbrido?
| Opción | + | − |
|---|---|---|
| Cloud (SaaS) | Rápido, sincronización sencilla, colectivo viable | Confianza/privacidad; costos de alojar |
| Local-first (datos en dispositivo) | Máxima propiedad | Sync/colectivo/jobs pesados muy difíciles; iOS limitado |
| Híbrido: cloud + export completo + opción self-host | Equilibrio | Dos modos que mantener |

**Recomendación**: Cloud con arquitectura portable (Postgres + S3 estándar, contenedores, export total) y self-host como opción empresarial más adelante. "La memoria te pertenece" se garantiza por exportación y formato abierto, no por ser local.

## D-03 ⏱ Lenguaje/stack de backend
| Opción | + | − |
|---|---|---|
| Python (FastAPI) | Mejor ecosistema ML/ASR/evals | Tipado más débil, menos uniforme con front |
| TypeScript (Node) | Un solo lenguaje con web; buen soporte SDK | Ecosistema ML más pobre (se resuelve con servicios) |

**Recomendación**: depende de tu fortaleza. Si no tenés preferencia: **TypeScript** para API/web y **Python** sólo para workers de ML si hace falta. Decisión tuya: ¿en qué stack sos más productivo?

## D-04 ⏱ Estrategia móvil
| Opción | + | − |
|---|---|---|
| PWA únicamente | Barata, multiplataforma | iOS PWA: sin share sheet real ni widgets potentes, background limitado |
| iOS nativa mínima (SwiftUI) + web | Fricción baja real (Action Button, share, intents) | Requiere Mac/Xcode y cuenta de desarrollador |
| Cross-platform (Expo/React Native) | Un código para iOS/Android | Extensiones nativas igual requieren código nativo |

**Recomendación**: Web/PWA en Fase 1; iOS nativa mínima en Fase 2 sólo para captura. Preguntas: ¿tenés Mac y cuenta Apple Developer? ¿Android importa?

## D-05 Base de datos
Ver ADR-0003. **Recomendación**: PostgreSQL + pgvector. Revisar con datos de Fase 3/5. Decisión abierta: ¿servicio gestionado (Neon/Supabase/RDS) o autoalojado? Gestionado sugerido al inicio, con cuidado de no usar funcionalidades propietarias que impidan salir.

## D-06 ⏱ Gateway LLM: construir vs. adoptar
| Opción | + | − |
|---|---|---|
| LiteLLM / gateways OSS | Rápido, muchos proveedores | Dependencia, abstracción con fugas |
| Propia, delgada | Control total, simple si son 3 proveedores | Mantenimiento |
| Framework (LangChain/LlamaIndex) | Muchos componentes | Acoplamiento, abstracciones cambiantes |

**Recomendación**: interfaz propia fina + adaptadores; usar LiteLLM como un adaptador más si ahorra tiempo. Evitar frameworks de orquestación pesados en el dominio.

## D-07 ASR y diarización
Local (Whisper/pyannote) = privacidad y costo marginal bajo, requiere GPU y operación. API (Deepgram, AssemblyAI, etc.) = mejor diarización, rapidez; datos salen. **Recomendación**: API con acuerdo de no retención para MVP, interfaz intercambiable, local como opción de privacidad. Validar español rioplatense en Fase 0.

## D-08 Embeddings
Modelo único multilingüe (API o local). **Recomendación**: decidir en benchmark de Fase 0 con tus datos en español; versionar el modelo y guardar los textos para re-embeber.

## D-09 ⏱ Consentimiento y grabación de reuniones
Reglas distintas por jurisdicción (consentimiento de una parte vs. todas). **Recomendación**: política de producto única y estricta: *aviso y consentimiento registrado de todos los participantes* antes de grabar. Asesoría legal local antes de Fase 2. Decidir: ¿opera sólo en Argentina inicialmente o global desde el principio?

## D-10 Modelo de negocio inicial
| Opción | + | − |
|---|---|---|
| Suscripción con cuota de IA incluida | Simple, previsible | Riesgo de margen si el uso explota |
| BYOK (clave propia) + suscripción baja | Margen sano, atrae técnicos | Fricción para no técnicos |
| Consumo por tokens | Alineado al costo | Mala UX |

**Recomendación**: híbrido — plan con cuota incluida + BYOK opcional; B2B por asiento. Definir después de Fase 0 con el modelo de costos. No monetizar hasta tener señal de retención.

## D-11 Alcance de proactividad
Opciones: sólo digest semanal / digest + alertas contextuales / alertas en tiempo real. **Recomendación**: digest primero (barato, bajo riesgo de molestar), alertas sólo para contradicciones de alta confianza.

## D-12 Señales de voz/video (emociones, gestos)
**Recomendación: no implementar.** Evidencia científica débil, riesgo legal (AI Act prohíbe inferir emociones en trabajo/educación; datos biométricos sensibles) y reputacional. Si hay demanda comprobada: sólo métricas objetivas de la conversación (turnos, tiempo de habla), opt-in, sin etiquetas psicológicas. Confirmar.

## D-13 Inteligencia colectiva: modelo de descubrimiento
| Opción | + | − |
|---|---|---|
| Sólo entre personas que ya se conocen (invitación) | Confianza, simple | Sin efecto de red |
| Broker con anonimato hasta aceptar | Efecto de red | Riesgo de inferencia, moderación |
| Sólo dentro de una organización | Alto valor, controlado | Es producto empresarial |

**Recomendación**: invitación en Fase 5, broker anónimo sólo después de pentest y con piloto cerrado.

## D-14 Propiedad intelectual de ideas compartidas
Requiere decisión legal/producto: ¿quién es dueño de ideas combinadas? **Recomendación**: términos que mantengan la autoría de cada aporte y, para la idea combinada, copropiedad por defecto con acuerdo explícito entre las partes al crear el espacio. Validar con abogado.

## D-15 Idioma y mercados iniciales
Español (rioplatense) + inglés. Afecta ASR, embeddings, prompts y legal. **Recomendación**: español e inglés desde el diseño; mercado inicial Argentina/LatAm para validación, preparando GDPR desde el día 1 para no reescribir.

## D-16 Hosting y soberanía
¿Proveedor cloud? ¿Región? Para empresas puede exigirse VPC/self-host. **Recomendación**: contenedores portables; elegir proveedor por costo/simplicidad en MVP.

## D-17 Nombre y marca
"MindSync" es provisional. Verificar disponibilidad de dominio y marcas (existen productos con nombres similares). No bloquea desarrollo.

## D-18 Licencia y apertura
¿Código cerrado, open-core o abierto? Afecta confianza ("tus datos te pertenecen") y modelo de negocio. **Recomendación**: cerrado al inicio, formato de export documentado y abierto; reconsiderar open-core si querés diferenciarte en confianza.

---

## Preguntas concretas para vos (las que más desbloquean)

1. ¿Qué stack dominás (TS/Python/otro)? ¿Tenés Mac para iOS?
2. ¿Trabajás solo o hay equipo? ¿Presupuesto mensual aproximado para infra + LLM en la fase de validación?
3. ¿Cuál es tu caso de uso personal #1 para el dogfooding? (ideas, reuniones o clientes)
4. ¿Vas a procesar reuniones reales con clientes? Eso adelanta la necesidad de resolver el tema legal.
5. ¿Tenés una fuente de datos reales (notas, transcripciones) para armar el set dorado?
