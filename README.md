# MindSync

Plataforma de inteligencia personal y colectiva. Documentación y decisiones: [`docs/`](docs/README.md).

## Probarlo (modo desarrollo)
```bash
npm install
cp .env.example .env        # y completá ANTHROPIC_API_KEY y GEMINI_API_KEY (el .env está en .gitignore)
npm run db:up               # Postgres 16 + pgvector en localhost:54329
npm run db:migrate
npm run dev                 # app en http://localhost:3000
```
La primera vez: **Crear cuenta con passkey** (tu email + huella/PIN del dispositivo). Se te muestran 8 códigos de recuperación **una sola vez**: guardalos. Después entrás con **Entrar con passkey**, sin email ni contraseña. Desde ahí: capturar, revisar lo extraído, preguntar a tu memoria, exportar y borrar.
**Correo:** sin SMTP configurado (`SMTP_URL` en el `.env`) no se envía nada real: el enlace de verificación se ve en el log del servidor y en el botón *📬 Ver correo de desarrollo* del aviso.
Si tu equipo no tiene cómo guardar passkeys (por ejemplo Chrome en Linux sin sesión de Google), activá `DEV_LOGIN=1` en el `.env` para entrar solo con el email en local. Es solo desarrollo y la API se niega a arrancar así en producción.
Para usarla desde el celular: el micrófono del navegador exige HTTPS (p. ej. un túnel como Cloudflare Tunnel o Tailscale Funnel hacia `localhost:3000`).

Otros comandos: `npm test` (todas las suites) · `npm run db:reset` (borra TODA la base de desarrollo, incluida tu cuenta) · `npm run db:clean-test-accounts` (ensayo; con `-- --yes` borra solo las cuentas `@test.local`).

**Bases de datos:** todo corre en Docker, en tu máquina (`mindsync-db-1`, puerto 54329, datos en el volumen `mindsync_dbdata`). Hay dos bases: `mindsync` (la tuya, con tus datos y passkeys) y `mindsync_test` (solo para tests; se crea sola y los tests se niegan a correr contra otra). Para borrar la base de desarrollo habría que borrar el volumen; los tests nunca lo hacen.

## Estado
| Paquete | Qué hace | Estado |
|---|---|---|
| `packages/db` | Esquema multi-workspace, RLS forzado, `withTenant`, migraciones | ✅ 31 tests de aislamiento |
| `packages/llm` | Gateway multi-LLM: rutas por tarea, fallback, timeout, `data_class`, salida validada con reintentos, embeddings | ✅ 15 tests. Adaptador de Anthropic **probado con la API real** (extracción con `claude-sonnet-5-5`); el OpenAI-compatible (Ollama/vLLM) sigue sin probar |
| `packages/memory` | Búsqueda híbrida (vector + texto, RRF) y chat con citas verificadas | ✅ 8 tests |
| `apps/api` | API Fastify: **passkeys (WebAuthn), códigos de recuperación, borrado de cuenta con reautenticación y verificación de email**, sesión, captura (texto/audio), revisión, búsqueda, chat, exportar/borrar. Detector de silencio y revisión de transcripciones | ✅ 90 tests |
| `apps/web` | App web (PWA) mobile-first: capturar, voz (WAV en el navegador), memoria, preguntar, fuentes | ✅ probada en navegador real |
| `packages/ingest` | Chunking (varios hablantes por fragmento), extracción con citas verificadas, pipeline con procedencia, idempotencia, auditoría | ✅ 19 tests con LLM simulado |

Pendiente (V1): cola de jobs (pg-boss; hoy la ingestión corre dentro del pedido HTTP), app iOS nativa, cambio de email, SMTP real de producción, perfil de clientes y borradores de mail.

## Prueba manual contra la API real
```bash
cd packages/ingest && npx tsx --env-file=../../.env scripts/smoke-extract.ts [archivo.txt]
```
Requiere `ANTHROPIC_API_KEY` en `.env` (ignorado por git). Sin argumento usa una reunión de ejemplo.

Proveedores probados con la API real: **Anthropic** (extracción) y **Gemini** (extracción y embeddings de 1024 dimensiones). Claves en `.env`: `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`. Si solo hay clave de Gemini, los embeddings van por Gemini.
Lecciones de las pruebas reales: `models.list()` de Gemini incluye modelos que devuelven 404; los modelos más nuevos se saturan (503); la cuota es por modelo (429). Por eso el gateway tiene timeout y respaldo. Smoke: `scripts/smoke-gemini.mts`.

## Hallazgos de las pruebas reales (importante)
- **Los modelos de transcripción inventan texto con audio sin voz.** Gemini devolvió una transcripción completa e inventada a partir de 6 minutos de silencio, aunque el prompt pedía `[sin voz]`. Defensas: detector de voz determinístico para WAV (`apps/api/src/audio.ts`, no llama al modelo si no hay señal) y revisión obligatoria de la transcripción antes de guardar. Límite: para formatos que no sea WAV el detector no corre; la revisión humana sí.
- Gemini: `models.list()` incluye modelos que dan 404; los modelos nuevos se saturan (503); la cuota es por modelo (429). Por eso el gateway tiene timeout y respaldo.
- Anthropic y Gemini rechazan cotas de esquema JSON (`maxItems`…) y `tool_choice` forzado: se usa `output_config.format` con un esquema sin cotas y Zod revalida.
