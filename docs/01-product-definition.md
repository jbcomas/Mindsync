# Entregable 1 — Product Definition

> Estado: borrador v0.1 para discusión. Lo marcado como **[HIPÓTESIS]** no está validado.

## 1. Visión

MindSync transforma pensamientos, experiencias y conversaciones de una persona en **conocimiento conectado, con procedencia, que evoluciona y que el usuario posee** (no el proveedor de LLM). Es una segunda mente: recuerda, relaciona, propone y, con permiso, actúa.

## 2. Problema

1. El conocimiento personal está fragmentado (notas, chats con IA, mails, reuniones, cabeza) y se pierde.
2. Los asistentes de IA actuales tienen memoria superficial, atada al proveedor, sin procedencia ni control.
3. Las ideas valiosas nacen en la **intersección** de cosas dichas en momentos distintos; nadie las cruza.
4. Capturar cuesta fricción; lo que no se captura en segundos, no se captura.
5. Vendedores y consultores pierden contexto de cada cliente entre reuniones.

## 3. Usuarios objetivo (orden de prioridad)

| Segmento | Dolor | Por qué primero/después |
|---|---|---|
| **P1: Profesional independiente / fundador / consultor / vendedor técnico** (tu perfil, dogfooding) | Muchas ideas, proyectos y clientes en paralelo | Un solo usuario, sin multi-tenant: validás rápido |
| P2: Equipos comerciales pequeños | Contexto de cliente disperso | Habilita Customer Intelligence y espacios compartidos |
| P3: Organizaciones | Conocimiento y decisiones perdidas | Requiere seguridad/compliance maduros |
| P4: Red de usuarios (inteligencia colectiva) | Colaboración entre memorias | Requiere masa crítica; ver riesgos |

## 4. Casos de uso núcleo

1. **Captura en <5 s** (voz/texto/share sheet) sin elegir dónde guardar.
2. **Recuperación**: "¿qué decidimos sobre X?", con citas a la fuente original.
3. **Conexión**: "esta idea se parece a lo que dijiste hace 2 semanas en la reunión con Y".
4. **Reunión → conocimiento**: decisiones, tareas, ideas con autoría, enlazadas a memoria previa.
5. **Asistente con acciones**: "mandale a Pérez el billing" → borrador en tu estilo, aprobás, se envía.
6. **Customer Intelligence**: "prepará presupuesto para este cliente" con contexto y precios autorizados.
7. **Colaboración entre memorias** (futuro): ideas compartidas por consentimiento, con autoría.

## 5. Diferenciación

| Competidor | Qué hace | Brecha que explota MindSync |
|---|---|---|
| ChatGPT / Claude (memoria) | Memoria opaca, ligada al proveedor | Memoria portable, auditable, multi-LLM, con procedencia |
| Notion AI / Obsidian+plugins | Notas + búsqueda IA | Captura sin fricción, extracción automática de entidades, proactividad |
| Rewind/Limitless/Granola/Otter/Fireflies | Captura de reuniones/pantalla | No convierten en grafo de conocimiento reutilizable ni cruzan con ideas propias |
| Mem, Reflect, Tana | Notas con IA y enlaces | Sin acciones, sin Customer Intelligence, sin capa colectiva |
| CRMs con IA (HubSpot, Gong) | Inteligencia comercial | Silo de ventas; MindSync une ventas + ideas + proyectos bajo límites de privacidad |

**Diferenciador defendible** (en orden de solidez): (1) propiedad y portabilidad de la memoria; (2) procedencia/trazabilidad de cada afirmación; (3) cruce entre dominios (ideas ↔ reuniones ↔ clientes); (4) capa colectiva con consentimiento. **[HIPÓTESIS]** Los puntos 1–2 son confianza; el 3 es el "wow"; el 4 es el foso de red, pero el más lejano.

> Crítica honesta: "memoria + IA" es un espacio muy disputado y los grandes proveedores lo irán absorbiendo. El valor sostenible no es la memoria en sí sino **procedencia + neutralidad de proveedor + cruce entre fuentes + red**. Eso debe guiar el MVP.

## 6. Customer Intelligence como módulo

Una sola plataforma, **espacios de conocimiento** distintos (personal, cliente, empresa) con la misma inteligencia y límites de privacidad estrictos. Coincido con tu decisión estratégica: no es una herramienta de ventas, es un módulo. Para el MVP: perfil de contacto/cliente con hechos con fuente + redacción de mail/propuesta con aprobación. Lo demás (aprendizaje de resultados, señales de voz/video, equipos) va después.

## 7. Cuestionamientos a la visión original

- **Captura ambiental continua**: costo, batería, legal y reputacional altos. Mantener fuera del MVP; empezar con captura *intencional*.
- **Señales de voz/video (emociones, gestos)**: la evidencia científica de inferir emoción/intención es débil, y en la UE el AI Act prohíbe inferir emociones en el trabajo. Recomiendo **no construirlo** en el MVP ni en la v1 enterprise; limitarse a métricas objetivas de la conversación (tiempo de habla, preguntas) si hay demanda.
- **Inteligencia colectiva** sin masa crítica no funciona (cold start). Se valida primero con 2–5 personas conocidas, manualmente.
- **Generación de ideas**: el riesgo principal es producir conexiones espurias que erosionan la confianza. Hace falta medir precisión de las sugerencias desde la primera versión.
- **Multi-agente**: no necesario al inicio (ver ADR-0005).

## 8. MVP recomendado

**Objetivo del MVP**: demostrar que, tras 4 semanas de uso real, MindSync te devuelve algo que no habrías recordado ni encontrado, con fuente verificable.

Incluye:
- Web app + PWA instalable (o app iOS mínima con share sheet, ver decisión D-04) con captura por texto y voz.
- Pipeline de ingestión: transcribir → extraer entidades (ideas, tareas, personas, decisiones) → embeddings → guardado con procedencia.
- Búsqueda híbrida y chat con citas a las fuentes originales.
- **Conexiones**: sugerencias "esto se relaciona con..." con explicación, origen y nivel de incertidumbre; feedback 👍/👎.
- Subida de transcripciones de reuniones (sin grabar en vivo todavía) con extracción de decisiones/tareas.
- Perfil de cliente/contacto básico + borrador de mail con aprobación manual (sin envío automático: abrir borrador en Gmail).
- Abstracción multi-LLM (2 proveedores + 1 local opcional).
- Exportación completa de la memoria (JSON/Markdown) y borrado.
- Usuario único, pero **modelo de datos ya preparado para multi-tenant** (columnas `owner_id`, `workspace_id`, RLS).

Excluye explícitamente del MVP: captura ambiental, GPS continuo, grabación en vivo de reuniones, video, compartir entre usuarios, ejecución autónoma de acciones, apps Windows/Linux nativas, multi-agente.

**Métricas de éxito**: ≥5 capturas/día durante 4 semanas; ≥30 % de conexiones sugeridas marcadas como útiles; recuperación correcta con cita en ≥80 % de 30 preguntas de prueba propias; tiempo de captura mediana <10 s.

## 9. Modelo de negocio (resumen, ver decisión D-10)

- **B2C/prosumer**: suscripción mensual con cuota de uso de IA; opción BYOK (traé tu clave de LLM) como plan barato.
- **B2B**: por asiento + volumen de reuniones/almacenamiento; el módulo Customer Intelligence como add-on.
- **Colectivo**: cobrar por espacio colaborativo/organización, nunca por "vender datos".
- Costos dominantes: transcripción, LLM, embeddings; modelar márgenes en Fase 0.
