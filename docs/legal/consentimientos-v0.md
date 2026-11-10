# Textos de consentimiento y avisos — v0 con revisión

> **No es asesoramiento legal.** Es un borrador técnico-producto para llevar a un abogado especializado en protección de datos (Argentina y, si se opera afuera, UE/EE. UU./Brasil). Los textos entre `[corchetes]` son variables. Marco legal citado: Ley 25.326 (AR), GDPR (UE), AI Act (UE), LGPD (BR), leyes estatales de grabación y biometría (EE. UU.). Las normas cambian: verificar vigencia antes de publicar, en especial si se aprobó la reforma de la Ley 25.326.

---

## 1. Revisión: problemas que tendría un texto "típico" y cómo los resuelvo

| # | Problema habitual | Por qué es un problema | Cómo queda resuelto |
|---|---|---|---|
| R-1 | "Al permanecer en la reunión aceptás ser grabado" | En GDPR el silencio o la inacción no es consentimiento (art. 4.11, 7). En Ley 25.326 se exige consentimiento libre, expreso e informado (art. 5). Muy débil como prueba | Aceptación **activa** de cada participante, o no se graba. Sin una opción de "aceptación tácita" |
| R-2 | Un solo "Acepto" para grabar, transcribir, analizar con IA y compartir | Consentimiento agrupado: no es específico ni granular | Finalidades separadas; solo la grabación y la transcripción son condición para grabar. Lo demás es opcional |
| R-3 | Identificar quién habla mediante "huella de voz" | La voz usada para **identificar** a una persona es dato biométrico: categoría especial (GDPR art. 9; LGPD art. 11; Illinois BIPA con consentimiento escrito y daños legales por infracción) | **V1 no crea huellas de voz.** La diarización separa hablantes ("Hablante 1/2") y el usuario los etiqueta a mano o desde el calendario. Ver R-3 en §6 |
| R-4 | Consentimiento en relación laboral o comercial asimétrica | El consentimiento de un empleado frente a su empleador no se considera libre (EDPB, Directrices 05/2020) | En V4 (empresa), la base legal para empleados es interés legítimo o contrato, con evaluación documentada. Para terceros, el consentimiento del texto §2 se mantiene |
| R-5 | No decir que hay IA ni proveedores externos | Falta de transparencia (Ley 25.326 art. 6; GDPR arts. 13–14). El AI Act exige transparencia en ciertos usos de IA | Se informa expresamente que hay procesamiento con IA, quiénes son los proveedores y que no entrenan con los datos (si el contrato lo garantiza) |
| R-6 | No decir que los datos salen del país | Transferencia internacional: Ley 25.326 art. 12 restringe transferencias a países sin protección adecuada (EE. UU. no figura como adecuado para Argentina); GDPR cap. V | Se informa el país y el mecanismo (cláusulas contractuales modelo de la AAIP / SCC de la UE) |
| R-7 | Retirar el consentimiento es más difícil que darlo | GDPR art. 7.3: debe ser igual de fácil | Botón o enlace de retiro en cada lugar donde se otorga, y durante la reunión |
| R-8 | Retención indefinida | Principios de limitación del plazo (Ley 25.326 art. 4.7; GDPR art. 5.1.e) | Plazos concretos por tipo de dato; el audio se borra antes que la transcripción |
| R-9 | Perfilar a los participantes ("estilo", "intención de compra", "emociones") | Inferencia de emociones en el trabajo prohibida en la UE (AI Act art. 5.1.f). Perfilado de terceros sin base legal clara | Prohibido por diseño (D-12). Se informa qué se extrae: temas, decisiones, tareas, necesidades **expresadas** |
| R-10 | Tratar a MindSync como responsable de lo que el usuario anota sobre terceros | Confunde roles; en uso profesional no aplica la excepción doméstica (GDPR art. 2.2.c) | Uso profesional: el **usuario** es responsable de los datos de terceros que captura y MindSync es encargado (DPA/contrato de encargo). MindSync es responsable de los datos de cuenta. Validar con abogado |

---

## 2. Aviso y consentimiento para participantes de una reunión

### 2.1 Guion verbal (lo lee el anfitrión antes de empezar; queda grabado como evidencia)

> "Antes de empezar: me gustaría grabar y transcribir esta reunión con MindSync, una herramienta con inteligencia artificial, para tener registro de lo que hablemos, las decisiones y las tareas. Solo la voy a usar yo [y mi equipo: nombres/rol]. Si alguien prefiere que no se grabe, no hay problema y no grabo. ¿Están de acuerdo? Necesito que cada uno me diga que sí."

- Si alguien dice que no → **no se graba** (o se toman notas manuales sin voz de esa persona).
- La app registra: fecha, participantes, respuesta de cada uno y el fragmento de audio del "sí" como evidencia.

### 2.2 Texto escrito (invitación de calendario o enlace antes de la reunión)

**Asunto: Esta reunión podría grabarse — necesitamos tu conformidad**

[Nombre del anfitrión] usa MindSync para grabar y transcribir reuniones con ayuda de inteligencia artificial. Antes de grabar te pedimos tu conformidad.

**Qué se hace**
- **Grabación de audio** de la reunión.
- **Transcripción** automática, separando los turnos de habla. No usamos tu voz para identificarte biométricamente.
- **Análisis con IA** para extraer temas, decisiones, tareas y acuerdos, y relacionarlos con notas previas de [anfitrión].

**Quién lo ve:** solo [anfitrión] [y las personas que indique: nombres/roles]. No se publica ni se vende.

**Quién lo procesa:** [Razón social de MindSync] como prestador del servicio, y proveedores de transcripción e IA ([lista, p. ej. proveedor de transcripción, Anthropic, OpenAI]), con contratos que les prohíben usar los datos para entrenar modelos. Los servidores están en [país/región]. La transferencia se ampara en [cláusulas contractuales modelo de la AAIP / SCC de la UE].

**Qué NO se hace:** no se analizan emociones, personalidad ni tono de voz para evaluarte. No se crea una huella de tu voz. No se toman decisiones automáticas sobre vos.

**Cuánto tiempo:** el audio se borra a los [30] días. La transcripción y lo extraído se conservan mientras [anfitrión] lo necesite, como máximo [24] meses, salvo que pidas el borrado antes.

**Tus derechos:** podés negarte sin ninguna consecuencia, retirar tu conformidad durante o después de la reunión, y pedir acceso, rectificación o borrado de tus intervenciones escribiendo a [contacto del anfitrión] o a [privacidad@dominio]. En Argentina, el órgano de control es la Agencia de Acceso a la Información Pública (AAIP).

Elegí una opción:
- [ ] **Acepto** que se grabe y transcriba la reunión.
- [ ] **Acepto también** que se use el análisis con IA para extraer decisiones y tareas. *(opcional)*
- [ ] **No acepto** que se grabe.

### 2.3 Reglas de producto asociadas (no negociables)
- Sin registro de consentimiento de **todos** los participantes, la app no permite iniciar la grabación (bloqueo duro).
- Indicador visible de grabación durante toda la reunión. En videollamadas, el bot se presenta con el nombre "MindSync (grabando)".
- Si alguien retira el consentimiento a mitad de la reunión, se detiene la grabación y se marca desde qué momento.
- Los participantes que llegan tarde deben aceptar al entrar o la grabación se pausa.
- Menores de edad: no se graba.
- **Reuniones subidas en V1** (grabadas fuera de la app): el usuario debe declarar que obtuvo el consentimiento, y la app guarda esa declaración. La responsabilidad recae en el usuario; los Términos deben decirlo claramente.

---

## 3. Aviso de privacidad y consentimientos del usuario de MindSync (registro)

**Pantalla de registro — "Cómo funciona tu memoria"**

MindSync guarda lo que capturás (notas, audios, documentos, reuniones) y lo procesa con inteligencia artificial para organizarlo, relacionarlo y ayudarte. **Tu memoria es tuya:** la podés exportar completa o borrar cuando quieras.

**Lo que es necesario para que el servicio funcione** (base: ejecución del contrato)
- Guardar tus capturas y procesarlas con IA para transcribir, extraer ideas, tareas, personas y decisiones, y buscar.
- Enviar los fragmentos necesarios a proveedores de IA ([lista]) que no usan tus datos para entrenar. Podés ver en cada respuesta qué fuentes se usaron.
- Datos fuera de [país]: [región de servidores]; mecanismo: [cláusulas modelo].

**Opcional — activalo solo si querés** (base: consentimiento; podés cambiarlo en Ajustes en cualquier momento)
- [ ] **Sugerencias proactivas**: que MindSync te avise cuando encuentre conexiones o contradicciones.
- [ ] **Aprender tu estilo de escritura** a partir de los mails que aprobás.
- [ ] **Contexto de ubicación** (ver §4).
- [ ] **Proveedores de IA adicionales** o modelos más potentes, si los elegís.

**Personas que mencionás**
Si capturás información sobre otras personas (clientes, colegas), vos sos responsable de tener una base legal para hacerlo y de respetar sus derechos. MindSync te da herramientas para encontrar, corregir y borrar todo lo relacionado con una persona. No captures datos sensibles de terceros (salud, religión, política, etc.). MindSync intenta detectarlos y te avisa.

**Lo que MindSync nunca hace**
No vende tus datos. No los usa para publicidad. No entrena modelos de IA con tu contenido. No infiere emociones ni rasgos de personalidad. No envía nada en tu nombre sin tu aprobación.

**Retención:** mientras tengas cuenta. Si borrás algo, se elimina de inmediato del servicio y de los backups en un plazo máximo de [30] días.

Enlaces: [Política de privacidad completa] · [Términos] · [Contacto de privacidad]

- [ ] Leí y acepto los Términos y la Política de privacidad. *(obligatorio, sin casilla premarcada)*

---

## 4. Ubicación (opt-in, permiso del sistema y de la app)

**Antes del diálogo de iOS:**

> **¿Querés que MindSync recuerde dónde estabas?**
> Cuando captures una idea o hagas una pregunta, MindSync puede guardar tu ubicación **aproximada** (barrio o ciudad) para darte contexto después o responder cosas como "¿hay un kiosco cerca?".
> - Solo en el momento de capturar o preguntar, **nunca en segundo plano**.
> - Precisión aproximada por defecto. Podés elegir exacta.
> - Podés borrar la ubicación de cualquier captura o desactivarla cuando quieras.
>
> [Activar] [Ahora no]

Configuración iOS: pedir solo "Al usar la app" y "Ubicación aproximada" por defecto. El texto de `NSLocationWhenInUseUsageDescription` debe coincidir con este aviso (App Review lo exige).

---

## 5. Compartir una idea (V3, borrador)

> **Vas a compartir: "[título de la idea]"**
> Con: [persona / espacio] · Puede: [ver] [ver y combinar con sus ideas] [citar]
> Hasta: [fecha / sin vencimiento]
>
> **Se comparte exactamente esto:** [previsualización]. **No** se comparte el resto de tu memoria, ni las fuentes originales salvo que las agregues.
> Tu autoría queda registrada en todo lo que se genere a partir de esta idea.
> Podés revocar el acceso cuando quieras. Lo que la otra persona ya haya leído no se puede "des-ver", y las ideas combinadas que ambos aceptaron se rigen por [los términos del espacio].
>
> [Compartir] [Cancelar]

---

## 6. Puntos abiertos para el abogado (priorizados)

1. **Roles responsable/encargado** (R-10): confirmar que, en uso profesional, el usuario es responsable de los datos de terceros y MindSync es encargado. Redactar el contrato de encargo (DPA).
2. **Grabación en Argentina** por un participante de la conversación: confirmar el encuadre en el Código Penal (art. 153 y ss.), el Código Civil y Comercial (art. 1770, intromisión en la vida privada) y la Ley 25.326. Confirmar el valor probatorio del guion verbal grabado.
3. **Inscripción de bases de datos** en el Registro Nacional de Bases de Datos (AAIP) y su alcance para MindSync y para usuarios que son empresas.
4. **Transferencias internacionales** a proveedores de IA y nube en EE. UU.: mecanismo (cláusulas modelo AAIP, Disposición 60/2016 y normativa vigente) y la mención en los avisos.
5. **EE. UU.**: estados con consentimiento de todas las partes (p. ej., California, Florida, Illinois, Washington, Pennsylvania, Maryland, Massachusetts) y biometría (Illinois BIPA). Hubo demandas colectivas contra asistentes de reuniones con IA por grabar a no usuarios. Decidir si se bloquea el uso en EE. UU. hasta revisar.
6. **AI Act (UE)**: confirmar que la prohibición del reconocimiento de emociones en el trabajo cubre lo descartado. Revisar las obligaciones de transparencia (art. 50) para contenido generado por IA, por ejemplo mails redactados en nombre del usuario.
7. **Retención**: validar los plazos propuestos (audio 30 días, transcripciones 24 meses, backups 30 días).
8. **Términos**: responsabilidad del usuario por subir reuniones grabadas fuera de la app; uso aceptable; prohibición de captura encubierta.
9. **Empleados (V4)**: base legal distinta del consentimiento y evaluación de impacto (DPIA/EIPD) si hay perfilado comercial.
10. **IP de ideas combinadas** (V3): ver D-14.

## 7. Decisión de producto que surge de esta revisión

- **V1 no implementa identificación de hablantes por voz.** Solo diarización con etiquetado manual o desde el calendario. Agregado al backlog como restricción de E8.
- **V1 solo se usa en Argentina** hasta tener el dictamen, y se evita grabar a participantes ubicados en EE. UU. o la UE, salvo con consentimiento escrito según §2.2.
- Los textos §2 y §3 son requisito de salida de V0 (dictamen) y de entrada a V1.
