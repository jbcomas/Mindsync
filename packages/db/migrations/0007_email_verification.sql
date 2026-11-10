-- 0007: verificación de email. Hasta verificarlo, el email es solo una etiqueta: NO puede usarse como identidad
-- (invitaciones, compartición, matching). Ver docs/08.

ALTER TABLE users ADD COLUMN email_verified_at timestamptz;

CREATE TABLE email_verifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       text NOT NULL,                  -- el email que se está verificando; si la cuenta cambia de email, el token deja de valer
  token_hash  text NOT NULL UNIQUE,           -- sha256 del token (256 bits aleatorios); el token solo viaja por mail
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz
);
CREATE INDEX email_verifications_user_idx ON email_verifications(user_id, created_at DESC);
ALTER TABLE email_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_verifications FORCE ROW LEVEL SECURITY;
CREATE POLICY email_verif_select ON email_verifications FOR SELECT USING (user_id = ms_current_user());
CREATE POLICY email_verif_insert ON email_verifications FOR INSERT WITH CHECK (user_id = ms_current_user());
CREATE POLICY email_verif_delete ON email_verifications FOR DELETE USING (user_id = ms_current_user());
GRANT SELECT, INSERT, DELETE ON email_verifications TO ms_app;
GRANT SELECT, UPDATE ON email_verifications TO ms_definer;
GRANT UPDATE (email_verified_at) ON users TO ms_definer;   -- solo el flujo de verificación puede marcarlo; la app no puede

-- Confirma un token: de un solo uso, vigente y emitido para el email ACTUAL de la cuenta. Devuelve el usuario o NULL.
CREATE FUNCTION ms_verify_email(p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid;
BEGIN
  UPDATE email_verifications v SET used_at = now() FROM users u
   WHERE v.token_hash = p_hash AND v.used_at IS NULL AND v.expires_at > now()
     AND u.id = v.user_id AND u.email = v.email
  RETURNING v.user_id INTO uid;
  IF uid IS NOT NULL THEN UPDATE users SET email_verified_at = coalesce(email_verified_at, now()) WHERE id = uid; END IF;
  RETURN uid;
END $$;
ALTER FUNCTION ms_verify_email(text) OWNER TO ms_definer;
REVOKE ALL ON FUNCTION ms_verify_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ms_verify_email(text) TO ms_app;

-- Para exigir email verificado en acciones futuras (invitar, compartir): SELECT ms_email_verified().
CREATE FUNCTION ms_email_verified() RETURNS boolean LANGUAGE sql STABLE AS
$$ SELECT coalesce((SELECT email_verified_at IS NOT NULL FROM users WHERE id = ms_current_user()), false) $$;
GRANT EXECUTE ON FUNCTION ms_email_verified() TO ms_app, ms_worker;

-- ------------------------------------------------------------------ refactor: la lógica de borrado pasa a ms_purge_user(uuid)
-- (interna, NO ejecutable por la app) para reutilizarla al reemplazar cuentas fantasma. ms_delete_account() sigue igual de cara afuera.
CREATE FUNCTION ms_purge_user(uid uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE solo uuid[]; n_ws int; n_src int; n_ent int; n_pk int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = uid) THEN RAISE EXCEPTION 'no_such_user' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(array_agg(w.id), '{}') INTO solo FROM workspaces w
   WHERE (w.created_by = uid OR EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.user_id = uid))
     AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = w.id AND m.user_id <> uid);
  IF EXISTS (SELECT 1 FROM workspaces w WHERE w.created_by = uid AND NOT (w.id = ANY (solo))) THEN
    RAISE EXCEPTION 'workspace_shared' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM sources  WHERE owner_id = uid AND NOT (workspace_id = ANY (solo)))
  OR EXISTS (SELECT 1 FROM entities WHERE owner_id = uid AND NOT (workspace_id = ANY (solo))) THEN
    RAISE EXCEPTION 'owns_shared_content' USING ERRCODE = '23514';
  END IF;
  n_ws  := coalesce(array_length(solo, 1), 0);
  n_src := (SELECT count(*) FROM sources  WHERE workspace_id = ANY (solo));
  n_ent := (SELECT count(*) FROM entities WHERE workspace_id = ANY (solo));
  n_pk  := (SELECT count(*) FROM passkeys WHERE user_id = uid);
  DELETE FROM workspaces  WHERE id = ANY (solo);
  DELETE FROM memberships WHERE user_id = uid;
  DELETE FROM users       WHERE id = uid;
  RETURN jsonb_build_object('workspaces', n_ws, 'sources', n_src, 'entities', n_ent, 'passkeys', n_pk);
END $$;
ALTER FUNCTION ms_purge_user(uuid) OWNER TO ms_definer;
REVOKE ALL ON FUNCTION ms_purge_user(uuid) FROM PUBLIC;       -- solo la llaman otras funciones definer

CREATE OR REPLACE FUNCTION ms_delete_account() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid := ms_current_user(); r jsonb;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'no_user_context' USING ERRCODE = '42501'; END IF;
  r := ms_purge_user(uid);
  INSERT INTO account_deletions(workspaces, sources, entities, passkeys)
    VALUES ((r->>'workspaces')::int, (r->>'sources')::int, (r->>'entities')::int, (r->>'passkeys')::int);
  RETURN r;
END $$;

-- ------------------------------------------------------------------ cuentas fantasma
-- Registrar un email que ya existe falla (nunca se agrega un passkey a una cuenta ajena), SALVO que esa cuenta sea una
-- reserva abandonada: sin verificar, de más de 24 h y sin ningún contenido. Así nadie puede bloquear el email de otra persona
-- registrándolo antes. Residual conocido: si el squatter carga contenido, la cuenta ya no se reemplaza (ver docs/08).
CREATE OR REPLACE FUNCTION ms_register_user_with_passkey(
  p_user uuid, p_email text, p_cred_id text, p_pubkey bytea, p_counter bigint, p_transports text[],
  p_device_type text, p_backed_up boolean, p_name text, p_code_hashes text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE wid uuid; h text; old uuid; old_verified timestamptz; old_created timestamptz;
BEGIN
  SELECT id, email_verified_at, created_at INTO old, old_verified, old_created FROM users WHERE email = lower(p_email);
  IF old IS NOT NULL THEN
    IF old_verified IS NULL AND old_created < now() - interval '24 hours' AND NOT EXISTS (SELECT 1 FROM sources WHERE owner_id = old) THEN
      BEGIN
        PERFORM ms_purge_user(old);
      EXCEPTION WHEN OTHERS THEN
        RAISE unique_violation USING MESSAGE = 'email_taken';
      END;
    ELSE
      RAISE unique_violation USING MESSAGE = 'email_taken';
    END IF;
  END IF;
  INSERT INTO users(id, email) VALUES (p_user, lower(p_email));
  INSERT INTO workspaces(kind, name, created_by) VALUES ('personal', 'Personal', p_user) RETURNING id INTO wid;
  INSERT INTO memberships(workspace_id, user_id, role) VALUES (wid, p_user, 'owner');
  INSERT INTO passkeys(user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (p_user, p_cred_id, p_pubkey, p_counter, coalesce(p_transports, '{}'), p_device_type, p_backed_up, coalesce(nullif(p_name, ''), 'Passkey'));
  FOREACH h IN ARRAY p_code_hashes LOOP INSERT INTO recovery_codes(user_id, code_hash) VALUES (p_user, h); END LOOP;
  RETURN p_user;
END $$;
