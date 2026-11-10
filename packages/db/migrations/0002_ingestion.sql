-- 0002_ingestion: estado de ingestión, dedupe de fuentes y registro de llamadas LLM (sin contenido, docs/08 A-7).

ALTER TABLE sources
  ADD COLUMN ingestion_status text NOT NULL DEFAULT 'pending' CHECK (ingestion_status IN ('pending','processing','done','failed')),
  ADD COLUMN ingestion_error  text,
  ADD COLUMN ingested_at      timestamptz;

-- Idempotencia: la misma fuente (mismo contenido) no se ingesta dos veces en un workspace.
CREATE UNIQUE INDEX sources_dedup ON sources (workspace_id, sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE llm_calls (
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  task          text NOT NULL,
  provider      text NOT NULL,
  model         text NOT NULL,
  data_class    text NOT NULL,
  input_tokens  int,
  output_tokens int,
  cost_usd      numeric(12,6),
  latency_ms    int,
  ok            boolean NOT NULL,
  error_kind    text,              -- categoría, nunca el mensaje con contenido
  source_id     uuid,
  at            timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
ALTER TABLE llm_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE llm_calls FORCE ROW LEVEL SECURITY;
CREATE POLICY llm_calls_ws ON llm_calls
  USING (workspace_id IN (SELECT ms_my_workspaces()))
  WITH CHECK (workspace_id IN (SELECT ms_my_workspaces()));
GRANT SELECT, INSERT ON llm_calls TO ms_app, ms_worker;
