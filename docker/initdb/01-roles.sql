-- Se ejecuta una sola vez al crear el volumen, como superusuario. Solo DEV.
-- Roles (ver docs/08-revision-seguridad-aislamiento.md, C-1):
--   ms_migrator: dueño de los objetos, solo corre migraciones. NO es superusuario.
--   ms_app / ms_worker: usados en runtime. Sin BYPASSRLS.
--   ms_definer: NOLOGIN con BYPASSRLS; dueño de las pocas funciones SECURITY DEFINER.
CREATE ROLE ms_migrator LOGIN PASSWORD 'migrator_dev' NOSUPERUSER NOBYPASSRLS;
CREATE ROLE ms_app      LOGIN PASSWORD 'app_dev'      NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE ms_worker   LOGIN PASSWORD 'worker_dev'   NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
CREATE ROLE ms_definer  NOLOGIN NOSUPERUSER BYPASSRLS;
GRANT ms_definer TO ms_migrator;

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER DATABASE mindsync OWNER TO ms_migrator;
ALTER SCHEMA public OWNER TO ms_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO ms_app, ms_worker, ms_definer;
GRANT CREATE ON SCHEMA public TO ms_definer;
