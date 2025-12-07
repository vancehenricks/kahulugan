FROM "pgvector/pgvector:pg18-trixie"

COPY ./init-db.sql /docker-entrypoint-initdb.d/01-init-pgvector.sql
COPY ./init-pg_trgm.sql /docker-entrypoint-initdb.d/02-init-pg_trgm.sql
