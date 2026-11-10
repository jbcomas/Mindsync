-- 0006: borrado completo de la cuenta (derecho de supresión). Backlog US-6.5.

-- Constancia de que se atendió el pedido, SIN ningún dato personal ni referencia al usuario: solo conteos.
CREATE TABLE account_deletions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deleted_at  timestamptz NOT NULL DEFAULT now(),
  workspaces  int NOT NULL,
  sources     int NOT NULL,
  entities    int NOT NULL,
  passkeys    int NOT NULL
);
ALTER TABLE account_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletions FORCE ROW LEVEL SECURITY;
CREATE POLICY account_deletions_none ON account_deletions USING (false) WITH CHECK (false);  -- la app no lo lee ni escribe
GRANT INSERT ON account_deletions TO ms_definer;
GRANT SELECT, DELETE ON users, workspaces, memberships TO ms_definer;
GRANT SELECT ON sources, entities, passkeys TO ms_definer;

-- Borra a QUIEN ESTÁ AUTENTICADO (ms_current_user()); no recibe un usuario como parámetro, así que no puede usarse sobre otro.
--  - Workspaces donde es el único miembro: se borran con TODO su contenido (cascada).
--  - Workspaces propios con otros miembros: se rechaza (hay que transferirlos antes): workspace_shared.
--  - Workspaces ajenos donde solo es miembro: solo se le quita la membresía.
--  - Si tiene contenido propio dentro de un workspace ajeno: se rechaza (owns_shared_content) hasta que se resuelva.
-- Todo ocurre en una transacción: o se borra todo o nada.
CREATE FUNCTION ms_delete_account() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  uid uuid := ms_current_user();
  solo uuid[]; n_ws int; n_src int; n_ent int; n_pk int;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'no_user_context' USING ERRCODE = '42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = uid) THEN RAISE EXCEPTION 'no_such_user' USING ERRCODE = 'P0002'; END IF;

  -- Workspaces del usuario en los que no hay nadie más.
  SELECT coalesce(array_agg(w.id), '{}') INTO solo FROM workspaces w
   WHERE (w.created_by = uid OR EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.user_id = uid))
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.user_id <> uid);

  -- Workspaces que creó pero comparte con otros: no se puede borrar la cuenta sin decidir qué pasa con ellos.
  IF EXISTS (SELECT 1 FROM workspaces w WHERE w.created_by = uid AND NOT (w.id = ANY (solo))) THEN
    RAISE EXCEPTION 'workspace_shared' USING ERRCODE = '23514';
  END IF;
  -- Contenido suyo dentro de workspaces ajenos (también bloquearía el borrado por clave foránea).
  IF EXISTS (SELECT 1 FROM sources  WHERE owner_id = uid AND NOT (workspace_id = ANY (solo)))
  OR EXISTS (SELECT 1 FROM entities WHERE owner_id = uid AND NOT (workspace_id = ANY (solo))) THEN
    RAISE EXCEPTION 'owns_shared_content' USING ERRCODE = '23514';
  END IF;

  n_ws  := coalesce(array_length(solo, 1), 0);
  n_src := (SELECT count(*) FROM sources  WHERE workspace_id = ANY (solo));
  n_ent := (SELECT count(*) FROM entities WHERE workspace_id = ANY (solo));
  n_pk  := (SELECT count(*) FROM passkeys WHERE user_id = uid);

  DELETE FROM workspaces  WHERE id = ANY (solo);          -- cascada: memberships, sources, chunks, embeddings, entities, relations, provenance, historial, llm_calls, audit_log
  DELETE FROM memberships WHERE user_id = uid;            -- membresías en workspaces ajenos
  DELETE FROM users       WHERE id = uid;                 -- cascada: passkeys, recovery_codes

  INSERT INTO account_deletions(workspaces, sources, entities, passkeys) VALUES (n_ws, n_src, n_ent, n_pk);
  RETURN jsonb_build_object('workspaces', n_ws, 'sources', n_src, 'entities', n_ent, 'passkeys', n_pk);
END $$;
ALTER FUNCTION ms_delete_account() OWNER TO ms_definer;
REVOKE ALL ON FUNCTION ms_delete_account() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms_delete_account() TO ms_app;
