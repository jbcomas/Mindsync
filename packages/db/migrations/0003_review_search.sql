-- 0003: revisión por el usuario, índice vectorial, login de desarrollo y borrado de fuentes.

-- ---------------------------------------------------------------- revisión (corrige un defecto de 0001)
-- 0001 impedía por CHECK que una fila creada por la IA tuviera validation_state <> 'unreviewed', lo que también
-- impedía que el USUARIO la confirmara. Ahora: la IA no puede INSERTAR algo confirmado/propio (trigger), y cualquier
-- estado de revisión exige reviewed_by_kind = 'user' (CHECK).
ALTER TABLE entities DROP CONSTRAINT ai_cannot_claim_ownership;
ALTER TABLE relations DROP CONSTRAINT ai_relation_unreviewed;

ALTER TABLE entities  ADD COLUMN reviewed_by_kind text CHECK (reviewed_by_kind = 'user'), ADD COLUMN reviewed_at timestamptz;
ALTER TABLE relations ADD COLUMN reviewed_by_kind text CHECK (reviewed_by_kind = 'user'), ADD COLUMN reviewed_at timestamptz;

ALTER TABLE entities ADD CONSTRAINT review_requires_user CHECK (
  (validation_state = 'unreviewed' AND epistemic_status <> 'decision_confirmed') OR reviewed_by_kind = 'user');
ALTER TABLE relations ADD CONSTRAINT relation_review_requires_user CHECK (
  validation_state = 'unreviewed' OR reviewed_by_kind = 'user');

CREATE FUNCTION entities_ai_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by_kind = 'ai' AND (NEW.origin_kind = 'own_thought'
       OR NEW.validation_state <> 'unreviewed' OR NEW.epistemic_status = 'decision_confirmed') THEN
    RAISE EXCEPTION 'ai_cannot_claim_ownership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER entities_ai_insert_guard_trg BEFORE INSERT ON entities FOR EACH ROW EXECUTE FUNCTION entities_ai_insert_guard();

CREATE FUNCTION relations_ai_insert_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by_kind = 'ai' AND NEW.validation_state <> 'unreviewed' THEN
    RAISE EXCEPTION 'ai_relation_unreviewed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER relations_ai_insert_guard_trg BEFORE INSERT ON relations FOR EACH ROW EXECUTE FUNCTION relations_ai_insert_guard();

-- ---------------------------------------------------------------- búsqueda
-- HNSW coseno. Con filtro por workspace conviene iterative_scan (se fija por transacción desde la capa de búsqueda).
CREATE INDEX embeddings_vector_idx ON embeddings USING hnsw (vector vector_cosine_ops);
CREATE INDEX embeddings_ws_aspect_idx ON embeddings (workspace_id, aspect);

-- ---------------------------------------------------------------- login de DESARROLLO
-- SOLO desarrollo: devuelve (o crea) el usuario por email SIN autenticar. La API únicamente lo invoca con DEV_LOGIN=1.
-- Se elimina cuando entre autenticación real con passkeys/OIDC (docs/08 §7).
CREATE FUNCTION ms_dev_login(p_email text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid;
BEGIN
  SELECT id INTO uid FROM users WHERE email = lower(p_email);
  IF uid IS NULL THEN uid := ms_signup(p_email); END IF;
  RETURN uid;
END $$;
ALTER FUNCTION ms_dev_login(text) OWNER TO ms_definer;
REVOKE ALL ON FUNCTION ms_dev_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms_dev_login(text) TO ms_app;
GRANT SELECT ON users TO ms_definer;

-- ---------------------------------------------------------------- borrado de una fuente con sus derivados (E6)
-- Borra la fuente (cascada: chunks, embeddings de chunks, provenance) y luego las entidades que quedaron sin ninguna
-- procedencia. Corre con los privilegios del invocador: RLS sigue aplicando.
CREATE FUNCTION ms_delete_source(p_workspace uuid, p_source uuid) RETURNS int
LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  DELETE FROM sources WHERE workspace_id = p_workspace AND id = p_source;
  IF NOT FOUND THEN RETURN 0; END IF;
  DELETE FROM entities e WHERE e.workspace_id = p_workspace
    AND NOT EXISTS (SELECT 1 FROM provenance p WHERE p.workspace_id = e.workspace_id AND p.entity_id = e.id);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;
GRANT EXECUTE ON FUNCTION ms_delete_source(uuid, uuid) TO ms_app;
