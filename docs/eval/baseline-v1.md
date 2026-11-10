# Evaluación de extracción — baseline-v1

- Prompt: **v1** · casos: **dev** · 2026-11-10T23:44:44.508Z
- Los casos los escribí yo (no son reuniones reales): sirven para comparar, no para predecir el rendimiento con tus reuniones.

| modelo | recall | completos* | tipo | hablante | estado epist. | contenido | ruido** | violaciones | relaciones | citas inventadas | fallos | tokens ent/sal | USD | ms/llamada |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic:claude-sonnet-5-5 | 86% | **76%** | 88% | 100% | 100% | 100% | 2% | **1** | 50% | 0% | 0/9 | 18278/10179 | $0.138 | 7656 |
| anthropic:claude-haiku-5-5 | 76% | **70%** | 96% | 100% | 100% | 95% | 4% | **1** | 25% | 0% | 0/9 | 18278/17040 | $0.010 | 8049 |
| gemini:gemini-3.5-flash-lite | 38% | **35%** | 93% | 100% | 100% | 100% | 13% | **2** | 0% | 0% | 3/9 | 4021/2331 | n/d | 2836 |
| gemini:gemini-3.6-flash | 19% | **19%** | 100% | 100% | 100% | 100% | 0% | **0** | 0% | 0% | 5/9 | 2522/6833 | n/d | 6623 |

\* *completo* = encontrado con la cita correcta Y tipo, hablante, estado epistémico y contenido correctos. ** *ruido* = items extraídos que no estaban esperados ni permitidos (puede incluir items válidos que no etiqueté: revisar la lista).

## anthropic:claude-sonnet-5-5

Faltantes 5 · tipo 4 · hablante 0 · estado 0 · contenido 0 · extras 1 · **violaciones 1**

**dev-sync** — 5/6 completos, 9 extraídos
- ❌ falta costo: «necesitamos más runners en CI y eso cuesta»

**ventas-cliente** — 6/8 completos, 10 extraídos
- ❌ falta enviar: «te armo una propuesta corta con el ahorro estimado en horas y en plata»
- ⚠ tipo pedro: esperado person|task|idea, salió concept («ERP Tango»)
- ➕ extra [person] Pedro (sistemas)  ← «preguntale a Pedro de sistemas.»

**precio-reversa** — 2/3 completos, 6 extraídos
- ⚠ tipo quince: esperado decision, salió idea («Lanzar a quince y subir el precio después»)

**asr-ruidoso-proveedor** — 1/4 completos, 2 extraídos
- ❌ falta cotizaciones: «Yo le pedí cotización a Logística Sur y a Transportes del Plata»
- ❌ falta comparar: «cuando tengas las cotizaciones las comparamos y decidimos»
- ⚠ tipo buscar: esperado task|decision|idea, salió project («Buscar otro proveedor»)

**planificacion-fecha-corregida** — 5/7 completos, 12 extraídos
- 🚫 VIOLACIÓN fecha superada: se corrió al 19: [event] Evento de marzo en el auditorio (fecha original: 12 de marzo)
- ❌ falta candidatos: «¿podés pasarme tres candidatos para fin de mes?»
- ⚠ tipo presupuesto: esperado concept|decision|idea, salió project («Campaña de marzo: presupuesto de USD 8.000»)

## anthropic:claude-haiku-5-5

Faltantes 9 · tipo 1 · hablante 0 · estado 0 · contenido 1 · extras 2 · **violaciones 1**

**dev-sync** — 2/6 completos, 9 extraídos
- ❌ falta paralelizar: «¿Y si los paralelizamos?»
- ❌ falta costo: «necesitamos más runners en CI y eso cuesta»
- ❌ falta aprobado: «Es poco. Aprobado, lo hacemos»
- ❌ falta postgres: «Estoy de acuerdo, la movemos a diciembre»

**precio-reversa** — 1/3 completos, 4 extraídos
- ❌ falta pagina: «la actualizo hoy»
- ⚠ tipo quince: esperado decision, salió idea («Lanzar a quince y subir el precio después»)

**chistes-hipotesis** — 3/4 completos, 5 extraídos
- ❌ falta armar: «Lo armo yo, pero necesito los números de ventas de Pablo»
- ➕ extra [decision] Posponer la apertura de oficina en Montevideo  ← «pero no es para ahora»

**asr-ruidoso-proveedor** — 3/4 completos, 7 extraídos
- ⚠ contenido cotizaciones: faltan [["logística sur","logistica sur"],["transportes del plata"]] en «Pedir cotizaciones a proveedores alternativos — Hablante 1 solicitó cotizaciones a dos empresas; esperan respuesta la semana próxima.»

**planificacion-fecha-corregida** — 4/7 completos, 12 extraídos
- 🚫 VIOLACIÓN fecha superada: se corrió al 19: [event] Evento en el auditorio (inicialmente 12 de marzo)
- ❌ falta presupuesto: «El presupuesto es de ocho mil dólares y la idea es gastarlo todo en redes»
- ❌ falta auditorio: «hoy mismo los llamo»
- ❌ falta candidatos: «¿podés pasarme tres candidatos para fin de mes?»
- ➕ extra [concept] Falta de buenas experiencias previas con influencers  ← «no tenemos buenas experiencias»

## gemini:gemini-3.5-flash-lite

Faltantes 23 · tipo 1 · hablante 0 · estado 0 · contenido 0 · extras 3 · **violaciones 2**

Fallos de llamada: ventas-cliente (all_failed), dev-sync (all_failed), nota-voz-divagando (all_failed)

**ventas-cliente** — 0/8 completos, 0 extraídos
- ❌ falta dolor: «Tardamos tres días en cerrar cada mes»
- ❌ falta propuesta: «automatizar la facturación con integración a tu ERP»
- ❌ falta tope: «Tenemos tope de cuatro mil quinientos dólares para este trimestre»
- ❌ falta alcance: «arrancar por el módulo de facturación y dejar reportes para el trimestre que viene»
- ❌ falta ricardo: «mi jefe, Ricardo, tiene que aprobar cualquier gasto»
- ❌ falta enviar: «te armo una propuesta corta con el ahorro estimado en horas y en plata»
- ❌ falta api: «yo averiguo si tu ERP tiene API abierta»
- ❌ falta pedro: «preguntale a Pedro de sistemas»

**dev-sync** — 0/6 completos, 0 extraídos
- ❌ falta paralelizar: «¿Y si los paralelizamos?»
- ❌ falta costo: «necesitamos más runners en CI y eso cuesta»
- ❌ falta aprobado: «Es poco. Aprobado, lo hacemos»
- ❌ falta runners: «Yo configuro los runners esta semana»
- ❌ falta postgres: «Estoy de acuerdo, la movemos a diciembre»
- ❌ falta log: «quiero que revises el log de errores del viernes»

**precio-reversa** — 1/3 completos, 4 extraídos
- ❌ falta pagina: «la actualizo hoy»
- ⚠ tipo caro: esperado concept|idea|event, salió person («Clientes de la beta»)

**nota-voz-divagando** — 0/3 completos, 0 extraídos
- ❌ falta onboarding: «si lo reduzco a tres pasos mejora la conversión»
- ❌ falta sofia: «llamar a Sofía de contabilidad por lo del contrato antes de fin de mes»
- ❌ falta anual: «probar un plan anual con descuento, tipo veinte por ciento»

**injection-roadmap** — 1/2 completos, 2 extraídos
- ❌ falta api: «la API pública, que la lanzamos en enero»
- ➕ extra [project] API pública  ← «la lanzamos en enero.»

**chistes-hipotesis** — 4/4 completos, 6 extraídos
- 🚫 VIOLACIÓN es una broma: [idea] Vender el producto a la NASA
- ➕ extra [person] Facundo  ← «lo trajo Facundo»
- ➕ extra [idea] Vender el producto a la NASA  ← «¿y si le vendemos el producto a la NASA?»

**planificacion-fecha-corregida** — 5/7 completos, 7 extraídos
- 🚫 VIOLACIÓN fecha superada: se corrió al 19: [event] Evento de marzo
- ❌ falta redes: «Lo dejamos todo en redes»
- ❌ falta auditorio: «hoy mismo los llamo»

**asr-ruidoso-proveedor** — 2/4 completos, 4 extraídos
- ❌ falta aumento: «Un quince por ciento, desde el primero de diciembre»
- ❌ falta cotizaciones: «Yo le pedí cotización a Logística Sur y a Transportes del Plata»

## gemini:gemini-3.6-flash

Faltantes 30 · tipo 0 · hablante 0 · estado 0 · contenido 0 · extras 0 · **violaciones 0**

Fallos de llamada: dev-sync (all_failed), ventas-cliente (all_failed), chistes-hipotesis (all_failed), asr-ruidoso-proveedor (all_failed), planificacion-fecha-corregida (all_failed)

**dev-sync** — 0/6 completos, 0 extraídos
- ❌ falta paralelizar: «¿Y si los paralelizamos?»
- ❌ falta costo: «necesitamos más runners en CI y eso cuesta»
- ❌ falta aprobado: «Es poco. Aprobado, lo hacemos»
- ❌ falta runners: «Yo configuro los runners esta semana»
- ❌ falta postgres: «Estoy de acuerdo, la movemos a diciembre»
- ❌ falta log: «quiero que revises el log de errores del viernes»

**ventas-cliente** — 0/8 completos, 0 extraídos
- ❌ falta dolor: «Tardamos tres días en cerrar cada mes»
- ❌ falta propuesta: «automatizar la facturación con integración a tu ERP»
- ❌ falta tope: «Tenemos tope de cuatro mil quinientos dólares para este trimestre»
- ❌ falta alcance: «arrancar por el módulo de facturación y dejar reportes para el trimestre que viene»
- ❌ falta ricardo: «mi jefe, Ricardo, tiene que aprobar cualquier gasto»
- ❌ falta enviar: «te armo una propuesta corta con el ahorro estimado en horas y en plata»
- ❌ falta api: «yo averiguo si tu ERP tiene API abierta»
- ❌ falta pedro: «preguntale a Pedro de sistemas»

**precio-reversa** — 2/3 completos, 3 extraídos
- ❌ falta quince: «mejor lanzamos a quince y vemos cómo se comporta»

**chistes-hipotesis** — 0/4 completos, 0 extraídos
- ❌ falta informe: «el lunes hay que mandar el informe trimestral a los inversores»
- ❌ falta armar: «Lo armo yo, pero necesito los números de ventas de Pablo»
- ❌ falta numeros: «Te los paso el domingo a la noche»
- ❌ falta montevideo: «abrir una oficina en Montevideo»

**asr-ruidoso-proveedor** — 0/4 completos, 0 extraídos
- ❌ falta aumento: «Un quince por ciento, desde el primero de diciembre»
- ❌ falta buscar: «tenemos que buscar otro proveedor, ya»
- ❌ falta cotizaciones: «Yo le pedí cotización a Logística Sur y a Transportes del Plata»
- ❌ falta comparar: «cuando tengas las cotizaciones las comparamos y decidimos»

**planificacion-fecha-corregida** — 0/7 completos, 0 extraídos
- ❌ falta logistica: «Yo me encargo de la logística y de pedir el catering»
- ❌ falta presupuesto: «El presupuesto es de ocho mil dólares y la idea es gastarlo todo en redes»
- ❌ falta redes: «Lo dejamos todo en redes»
- ❌ falta influencers: «propongo reservar dos mil para influencers»
- ❌ falta fecha: «entonces el evento es el 19 de marzo»
- ❌ falta auditorio: «hoy mismo los llamo»
- ❌ falta candidatos: «¿podés pasarme tres candidatos para fin de mes?»
