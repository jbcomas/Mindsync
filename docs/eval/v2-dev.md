# Evaluación de extracción — v2-dev

- Prompt: **v2** · casos: **dev** · 2026-11-10T23:46:31.284Z
- Los casos los escribí yo (no son reuniones reales): sirven para comparar, no para predecir el rendimiento con tus reuniones.

| modelo | recall | completos* | tipo | hablante | estado epist. | contenido | ruido** | violaciones | relaciones | citas inventadas | fallos | tokens ent/sal | USD | ms/llamada |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| anthropic:claude-sonnet-5-5 | 76% | **70%** | 93% | 100% | 100% | 100% | 7% | **0** | 25% | 0% | 0/9 | 24947/8924 | $0.139 | 6845 |
| anthropic:claude-haiku-5-5 | 65% | **59%** | 92% | 100% | 100% | 100% | 5% | **1** | 25% | 0% | 0/9 | 29798/18259 | $0.012 | 8476 |

\* *completo* = encontrado con la cita correcta Y tipo, hablante, estado epistémico y contenido correctos. ** *ruido* = items extraídos que no estaban esperados ni permitidos (puede incluir items válidos que no etiqueté: revisar la lista).

## anthropic:claude-sonnet-5-5

Faltantes 9 · tipo 2 · hablante 0 · estado 0 · contenido 0 · extras 3 · **violaciones 0**

**dev-sync** — 3/6 completos, 7 extraídos
- ❌ falta paralelizar: «¿Y si los paralelizamos?»
- ❌ falta costo: «necesitamos más runners en CI y eso cuesta»
- ❌ falta log: «quiero que revises el log de errores del viernes»

**ventas-cliente** — 6/8 completos, 10 extraídos
- ❌ falta enviar: «te armo una propuesta corta con el ahorro estimado en horas y en plata»
- ⚠ tipo pedro: esperado person|task|idea, salió concept («El ERP es Tango y probablemente tiene API»)
- ➕ extra [person] Ricardo  ← «mi jefe, Ricardo, tiene que aprobar cualquier gasto.»
- ➕ extra [person] Pedro (sistemas)  ← «preguntale a Pedro de sistemas»

**precio-reversa** — 2/3 completos, 3 extraídos
- ❌ falta quince: «mejor lanzamos a quince y vemos cómo se comporta»

**chistes-hipotesis** — 2/4 completos, 3 extraídos
- ❌ falta montevideo: «abrir una oficina en Montevideo»
- ⚠ tipo informe: esperado task, salió concept («Plazo: informe trimestral a inversores el lunes»)

**planificacion-fecha-corregida** — 4/7 completos, 9 extraídos
- ❌ falta presupuesto: «El presupuesto es de ocho mil dólares y la idea es gastarlo todo en redes»
- ❌ falta influencers: «propongo reservar dos mil para influencers»
- ❌ falta candidatos: «¿podés pasarme tres candidatos para fin de mes?»
- ➕ extra [concept] Objeción a los influencers: malas experiencias previas  ← «no me convence lo de influencers, no tenemos buenas experiencias»

## anthropic:claude-haiku-5-5

Faltantes 13 · tipo 2 · hablante 0 · estado 0 · contenido 0 · extras 2 · **violaciones 1**

**dev-sync** — 1/6 completos, 6 extraídos
- ❌ falta paralelizar: «¿Y si los paralelizamos?»
- ❌ falta costo: «necesitamos más runners en CI y eso cuesta»
- ❌ falta aprobado: «Es poco. Aprobado, lo hacemos»
- ❌ falta postgres: «Estoy de acuerdo, la movemos a diciembre»
- ❌ falta log: «quiero que revises el log de errores del viernes»

**precio-reversa** — 2/3 completos, 4 extraídos
- ⚠ tipo quince: esperado decision, salió idea («Subir el precio después del lanzamiento»)

**chistes-hipotesis** — 2/4 completos, 2 extraídos
- ❌ falta informe: «el lunes hay que mandar el informe trimestral a los inversores»
- ❌ falta montevideo: «abrir una oficina en Montevideo»

**ventas-cliente** — 7/8 completos, 12 extraídos
- ⚠ tipo alcance: esperado decision, salió idea («Arrancar por el módulo de facturación y dejar reportes para el trimestre que viene»)
- ➕ extra [person] Ricardo  ← «mi jefe, Ricardo, tiene que aprobar cualquier gasto»

**injection-roadmap** — 1/2 completos, 2 extraídos
- ❌ falta api: «la API pública, que la lanzamos en enero»
- ➕ extra [project] Lanzamiento de la API pública en enero  ← «la lanzamos en enero»

**asr-ruidoso-proveedor** — 3/4 completos, 4 extraídos
- 🚫 VIOLACIÓN texto prohibido /\[inaudible\]/i: [concept] El proveedor subió el precio un 15% desde el 1 de diciembre
- ❌ falta cotizaciones: «Yo le pedí cotización a Logística Sur y a Transportes del Plata»

**planificacion-fecha-corregida** — 3/7 completos, 8 extraídos
- ❌ falta presupuesto: «El presupuesto es de ocho mil dólares y la idea es gastarlo todo en redes»
- ❌ falta influencers: «propongo reservar dos mil para influencers»
- ❌ falta fecha: «entonces el evento es el 19 de marzo»
- ❌ falta candidatos: «¿podés pasarme tres candidatos para fin de mes?»
