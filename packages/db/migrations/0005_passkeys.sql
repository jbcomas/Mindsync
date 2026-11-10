-- 0005: autenticación con passkeys (WebAuthn) y códigos de recuperación. ELIMINA el login de desarrollo (ms_dev_login).

DROP FUNCTION ms_dev_login(text);
REVOKE SELECT ON users FROM ms_definer;   -- ya no hace falta para login; se re-otorga abajo solo lo necesario

CREATE TABLE passkeys (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  credential_id text NOT NULL UNIQUE,            -- base64url
  public_key    bytea NOT NULL,                  -- COSE
  counter       bigint NOT NULL DEFAULT 0 CHECK (counter >= 0),
  transports    text[] NOT NULL DEFAULT '{}',
  device_type   text NOT NULL CHECK (device_type IN ('singleDevice','multiDevice')),
  backed_up     boolean NOT NULL,
  name          text NOT NULL DEFAULT 'Passkey' CHECK (length(name) BETWEEN 1 AND 60),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);
CREATE INDEX passkeys_user_idx ON passkeys(user_id);

CREATE TABLE recovery_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash  text NOT NULL,                      -- sha256 de un código de ~80 bits de entropía; nunca el código
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, code_hash)
);

ALTER TABLE passkeys ENABLE ROW LEVEL SECURITY;       ALTER TABLE passkeys FORCE ROW LEVEL SECURITY;
ALTER TABLE recovery_codes ENABLE ROW LEVEL SECURITY; ALTER TABLE recovery_codes FORCE ROW LEVEL SECURITY;

CREATE POLICY passkeys_select ON passkeys FOR SELECT USING (user_id = ms_current_user());
CREATE POLICY passkeys_insert ON passkeys FOR INSERT WITH CHECK (user_id = ms_current_user());
CREATE POLICY passkeys_update ON passkeys FOR UPDATE USING (user_id = ms_current_user()) WITH CHECK (user_id = ms_current_user());
CREATE POLICY passkeys_delete ON passkeys FOR DELETE USING (user_id = ms_current_user());
CREATE POLICY recovery_select ON recovery_codes FOR SELECT USING (user_id = ms_current_user());
CREATE POLICY recovery_insert ON recovery_codes FOR INSERT WITH CHECK (user_id = ms_current_user());
CREATE POLICY recovery_delete ON recovery_codes FOR DELETE USING (user_id = ms_current_user());

-- El usuario autenticado solo puede renombrar sus passkeys; el contador y la clave los toca únicamente el login (definer).
GRANT SELECT, INSERT, DELETE ON passkeys, recovery_codes TO ms_app;
GRANT UPDATE (name) ON passkeys TO ms_app;
GRANT SELECT, INSERT, UPDATE ON passkeys TO ms_definer;
GRANT SELECT, INSERT, UPDATE ON recovery_codes TO ms_definer;
GRANT SELECT, INSERT ON users, workspaces, memberships TO ms_definer;

-- Nunca dejar a un usuario sin ningún passkey (perdería el acceso a su memoria). Si el usuario ya no existe
-- (borrado en cascada de la cuenta) se permite.
CREATE FUNCTION passkeys_keep_one() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE id = OLD.user_id)
     AND NOT EXISTS (SELECT 1 FROM passkeys WHERE user_id = OLD.user_id AND id <> OLD.id) THEN
    RAISE EXCEPTION 'last_passkey' USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;
ALTER FUNCTION passkeys_keep_one() OWNER TO ms_definer;
GRANT SELECT ON users TO ms_definer;
CREATE TRIGGER passkeys_keep_one_trg BEFORE DELETE ON passkeys FOR EACH ROW EXECUTE FUNCTION passkeys_keep_one();

-- ------------------------------------------------------------------ funciones de login (el usuario aún no está autenticado)
-- Alta atómica: usuario + workspace personal + membresía + primer passkey + hashes de recuperación.
-- Si el email ya existe falla con unique_violation: NUNCA agrega un passkey a una cuenta existente (toma de cuenta).
CREATE FUNCTION ms_register_user_with_passkey(
  p_user uuid, p_email text, p_cred_id text, p_pubkey bytea, p_counter bigint, p_transports text[],
  p_device_type text, p_backed_up boolean, p_name text, p_code_hashes text[]
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE wid uuid; h text;
BEGIN
  INSERT INTO users(id, email) VALUES (p_user, lower(p_email));
  INSERT INTO workspaces(kind, name, created_by) VALUES ('personal', 'Personal', p_user) RETURNING id INTO wid;
  INSERT INTO memberships(workspace_id, user_id, role) VALUES (wid, p_user, 'owner');
  INSERT INTO passkeys(user_id, credential_id, public_key, counter, transports, device_type, backed_up, name)
    VALUES (p_user, p_cred_id, p_pubkey, p_counter, coalesce(p_transports, '{}'), p_device_type, p_backed_up, coalesce(nullif(p_name, ''), 'Passkey'));
  FOREACH h IN ARRAY p_code_hashes LOOP INSERT INTO recovery_codes(user_id, code_hash) VALUES (p_user, h); END LOOP;
  RETURN p_user;
END $$;

CREATE FUNCTION ms_passkey_lookup(p_cred_id text)
RETURNS TABLE (passkey_id uuid, user_id uuid, public_key bytea, counter bigint, transports text[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
$$ SELECT id, user_id, public_key, counter, transports FROM passkeys WHERE credential_id = p_cred_id $$;

-- Actualiza el contador solo hacia adelante (anti-clonado). Devuelve false si se intentó retroceder.
CREATE FUNCTION ms_passkey_touch(p_cred_id text, p_counter bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE passkeys SET counter = GREATEST(counter, p_counter), last_used_at = now()
   WHERE credential_id = p_cred_id AND (p_counter >= counter);
  RETURN FOUND;
END $$;

-- Consume un código de recuperación (un solo uso). Devuelve el usuario o NULL.
CREATE FUNCTION ms_recovery_login(p_email text, p_hash text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE uid uuid;
BEGIN
  UPDATE recovery_codes rc SET used_at = now()
   WHERE rc.code_hash = p_hash AND rc.used_at IS NULL
     AND rc.user_id = (SELECT id FROM users WHERE email = lower(p_email))
  RETURNING rc.user_id INTO uid;
  RETURN uid;
END $$;

DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['ms_register_user_with_passkey(uuid,text,text,bytea,bigint,text[],text,boolean,text,text[])',
                           'ms_passkey_lookup(text)','ms_passkey_touch(text,bigint)','ms_recovery_login(text,text)'] LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO ms_definer', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO ms_app', f);
  END LOOP;
END $$;
