-- Enable pgvector extension (used for vector storage / similarity search)
CREATE EXTENSION IF NOT EXISTS vector;

-- Increase maintenance_work_mem to a safe default for index builds and
-- restores. This runs once on initial database initialization inside the
-- container and sets the server-wide setting via ALTER SYSTEM.
-- You may change this value later via ALTER SYSTEM or your Postgres config.
ALTER SYSTEM SET maintenance_work_mem = '256MB';
SELECT pg_reload_conf();