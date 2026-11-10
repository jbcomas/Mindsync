-- 0001_core: modelo base multi-workspace con RLS forzado.
-- Reglas: ver docs/02-architecture.md §4-5, ADR-0002, ADR-0004, docs/08-revision-seguridad-aislamiento.md
-- Se ejecuta como ms_migrator (dueño). Nada acá usa superusuario.

-- ---------------------------------------------------------------- helpers
-- Usuario actual: SOLO de set_config('app.user_id', ..., true) dentro de la transacción (C-2).
-- Sin contexto => NULL => ninguna política concede acceso.
CREATE FUNCTION ms_current_user() RETURNS uuid
LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- cuentas
CREATE TABLE users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL CHECK (kind IN ('personal','client','team','org')),
  name        text NOT NULL,
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner','admin','member','viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

-- Workspaces a los que pertenece el usuario actual (C-3): se resuelve en la DB, no desde el cliente.
-- Corre con los privilegios del invocador, así que memberships sigue bajo RLS (solo filas propias).
CREATE FUNCTION ms_my_workspaces() RETURNS SETOF uuid
LANGUAGE sql STABLE AS
$$ SELECT workspace_id FROM memberships WHERE user_id = ms_current_user() $$;

-- ---------------------------------------------------------------- datos (todas con workspace_id)
-- PK y FK compuestas (workspace_id, id): imposible referenciar filas de otro workspace (A-1).

CREATE TABLE sources (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id),
  kind         text NOT NULL CHECK (kind IN ('text','voice','audio','document','web','meeting','ai_conversation','import')),
  storage_key  text,                 -- t/{tenant}/w/{workspace}/{uuid} en object storage (A-2)
  sha256       text,
  captured_at  timestamptz NOT NULL DEFAULT now(),
  context      jsonb NOT NULL DEFAULT '{}'::jsonb,
  consent      jsonb,                -- registro de consentimiento si hay terceros (docs/legal)
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE chunks (
  workspace_id uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  source_id    uuid NOT NULL,
  locator      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- offset / timestamp / hablante
  text         text NOT NULL,
  tsv          tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, source_id) REFERENCES sources(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX chunks_source_idx ON chunks (workspace_id, source_id);

CREATE TABLE entities (
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  id                uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_id          uuid NOT NULL REFERENCES users(id),
  type              text NOT NULL CHECK (type IN
                      ('thought','idea','concept','project','person','conversation','meeting',
                       'decision','task','event','organization','opportunity')),
  title             text NOT NULL,
  body              text,
  created_by_kind   text NOT NULL CHECK (created_by_kind IN ('user','ai','import')),
  origin_kind       text NOT NULL CHECK (origin_kind IN ('own_thought','said_by_other','ai_generated','imported','derived')),
  epistemic_status  text NOT NULL CHECK (epistemic_status IN ('observation','claim','hypothesis','decision_confirmed','proposal')),
  confidence        real NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  validation_state  text NOT NULL DEFAULT 'unreviewed' CHECK (validation_state IN ('unreviewed','confirmed','corrected','rejected')),
  valid_from        timestamptz,
  valid_to          timestamptz,
  derived_from_grants uuid[] NOT NULL DEFAULT '{}',   -- taint tracking para revocación (A-5)
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  -- La IA nunca escribe como idea propia ni como confirmado (ADR-0002 regla 5).
  CONSTRAINT ai_cannot_claim_ownership CHECK (
    created_by_kind <> 'ai'
    OR (origin_kind <> 'own_thought'
        AND validation_state = 'unreviewed'
        AND epistemic_status <> 'decision_confirmed')
  )
);
CREATE INDEX entities_type_idx ON entities (workspace_id, type);

CREATE TABLE entity_history (
  workspace_id uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  version      int  NOT NULL,
  diff         jsonb NOT NULL,
  changed_by   text NOT NULL CHECK (changed_by IN ('user','ai','import')),
  at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  UNIQUE (workspace_id, entity_id, version),
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entities(workspace_id, id) ON DELETE CASCADE
);

CREATE TABLE relations (
  workspace_id     uuid NOT NULL,
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  from_id          uuid NOT NULL,
  to_id            uuid NOT NULL,
  kind             text NOT NULL,
  created_by_kind  text NOT NULL CHECK (created_by_kind IN ('user','ai','import')),
  confidence       real NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  rationale        text,
  validation_state text NOT NULL DEFAULT 'unreviewed' CHECK (validation_state IN ('unreviewed','confirmed','corrected','rejected')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, from_id) REFERENCES entities(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, to_id)   REFERENCES entities(workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT ai_relation_unreviewed CHECK (created_by_kind <> 'ai' OR validation_state = 'unreviewed')
);
CREATE INDEX relations_from_idx ON relations (workspace_id, from_id);
CREATE INDEX relations_to_idx   ON relations (workspace_id, to_id);

CREATE TABLE provenance (
  workspace_id uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  entity_id    uuid NOT NULL,
  source_id    uuid NOT NULL,
  chunk_id     uuid,
  quote        text,
  asserted_by_entity_id uuid,        -- quién lo dijo (persona), si aplica
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entities(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, source_id) REFERENCES sources(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, chunk_id)  REFERENCES chunks(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, asserted_by_entity_id) REFERENCES entities(workspace_id, id) ON DELETE SET NULL (asserted_by_entity_id)
);

-- Dimensión provisional (1024): se fija definitivamente con el benchmark de embeddings de V0 (D-08).
-- El índice HNSW se crea después de elegir el modelo.
CREATE TABLE embeddings (
  workspace_id uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  chunk_id     uuid,
  entity_id    uuid,
  aspect       text NOT NULL CHECK (aspect IN ('literal','abstract')),
  model        text NOT NULL,
  vector       vector(1024) NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id),
  CHECK ((chunk_id IS NOT NULL) <> (entity_id IS NOT NULL)),
  FOREIGN KEY (workspace_id, chunk_id)  REFERENCES chunks(workspace_id, id)   ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, entity_id) REFERENCES entities(workspace_id, id) ON DELETE CASCADE
);

-- Auditoría: solo INSERT para la app, con hash encadenado por workspace (A-8). Sin contenido, solo referencias.
CREATE TABLE audit_log (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  seq          bigint NOT NULL,
  actor_id     uuid,
  actor_kind   text NOT NULL CHECK (actor_kind IN ('user','ai','system')),
  action       text NOT NULL,
  target_type  text,
  target_id    uuid,
  meta         jsonb NOT NULL DEFAULT '{}'::jsonb,   -- NUNCA contenido
  at           timestamptz NOT NULL DEFAULT now(),
  prev_hash    bytea,
  hash         bytea NOT NULL,
  PRIMARY KEY (workspace_id, seq)
);

CREATE FUNCTION audit_log_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE last_seq bigint; last_hash bytea;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text, 0));
  SELECT seq, hash INTO last_seq, last_hash
    FROM audit_log WHERE workspace_id = NEW.workspace_id ORDER BY seq DESC LIMIT 1;
  NEW.seq := coalesce(last_seq, 0) + 1;
  NEW.prev_hash := last_hash;
  NEW.hash := digest(
    coalesce(encode(last_hash, 'hex'), '') || NEW.workspace_id::text || NEW.seq::text ||
    coalesce(NEW.actor_id::text, '') || NEW.actor_kind || NEW.action ||
    coalesce(NEW.target_type, '') || coalesce(NEW.target_id::text, '') ||
    NEW.meta::text || NEW.at::text, 'sha256');
  RETURN NEW;
END $$;
-- seq/hash los asigna el trigger; los defaults permiten insertar sin ellos.
ALTER TABLE audit_log ALTER COLUMN seq SET DEFAULT 0;
ALTER TABLE audit_log ALTER COLUMN hash SET DEFAULT '\x'::bytea;
CREATE TRIGGER audit_log_chain_trg BEFORE INSERT ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_chain();

-- ---------------------------------------------------------------- RLS
-- Toda tabla con datos: ENABLE + FORCE (el dueño tampoco la saltea) (C-1).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','workspaces','memberships','sources','chunks','entities',
                           'entity_history','relations','provenance','embeddings','audit_log']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Tablas de cuentas
CREATE POLICY users_self ON users
  USING (id = ms_current_user()) WITH CHECK (id = ms_current_user());

CREATE POLICY workspaces_select ON workspaces FOR SELECT
  USING (created_by = ms_current_user() OR id IN (SELECT ms_my_workspaces()));
CREATE POLICY workspaces_insert ON workspaces FOR INSERT
  WITH CHECK (created_by = ms_current_user());
CREATE POLICY workspaces_update ON workspaces FOR UPDATE
  USING (id IN (SELECT workspace_id FROM memberships WHERE user_id = ms_current_user() AND role IN ('owner','admin')))
  WITH CHECK (id IN (SELECT workspace_id FROM memberships WHERE user_id = ms_current_user() AND role IN ('owner','admin')));

CREATE POLICY memberships_select ON memberships FOR SELECT
  USING (user_id = ms_current_user());
-- Solo puede auto-agregarse como owner a un workspace que él creó. Invitar a otros: fase posterior, vía función dedicada.
CREATE POLICY memberships_insert ON memberships FOR INSERT
  WITH CHECK (user_id = ms_current_user() AND role = 'owner'
              AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = workspace_id AND w.created_by = ms_current_user()));

-- Tablas de datos: pertenecer al workspace. WITH CHECK impide escribir en workspaces ajenos.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['sources','chunks','entities','entity_history','relations','provenance','embeddings']
  LOOP
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (workspace_id IN (SELECT ms_my_workspaces())) WITH CHECK (workspace_id IN (SELECT ms_my_workspaces()))',
      t || '_ws', t);
  END LOOP;
END $$;

CREATE POLICY audit_select ON audit_log FOR SELECT USING (workspace_id IN (SELECT ms_my_workspaces()));
CREATE POLICY audit_insert ON audit_log FOR INSERT WITH CHECK (workspace_id IN (SELECT ms_my_workspaces()));

-- ---------------------------------------------------------------- privilegios
GRANT SELECT, INSERT, UPDATE, DELETE ON
  sources, chunks, entities, entity_history, relations, provenance, embeddings
  TO ms_app, ms_worker;
GRANT SELECT, UPDATE ON workspaces TO ms_app, ms_worker;
GRANT INSERT ON workspaces TO ms_app;
GRANT SELECT, INSERT ON memberships TO ms_app;
GRANT SELECT ON memberships TO ms_worker;
GRANT SELECT ON users TO ms_app, ms_worker;
-- audit_log: solo INSERT y SELECT (nunca UPDATE/DELETE) (A-8).
GRANT SELECT, INSERT ON audit_log TO ms_app, ms_worker;
GRANT EXECUTE ON FUNCTION ms_current_user(), ms_my_workspaces() TO ms_app, ms_worker;

-- ---------------------------------------------------------------- alta de usuario (bootstrap)
-- El alta crea usuario + workspace personal + membresía de forma atómica. Es el único punto con SECURITY DEFINER
-- (dueño ms_definer, que tiene BYPASSRLS). search_path fijo.
CREATE FUNCTION ms_signup(p_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid; wid uuid;
BEGIN
  INSERT INTO users(email) VALUES (lower(p_email)) RETURNING id INTO uid;
  INSERT INTO workspaces(kind, name, created_by) VALUES ('personal', 'Personal', uid) RETURNING id INTO wid;
  INSERT INTO memberships(workspace_id, user_id, role) VALUES (wid, uid, 'owner');
  RETURN uid;
END $$;
ALTER FUNCTION ms_signup(text) OWNER TO ms_definer;
REVOKE ALL ON FUNCTION ms_signup(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms_signup(text) TO ms_app;
GRANT SELECT, INSERT ON users, workspaces, memberships TO ms_definer;
