# Kahulugan

AI-powered legal research chatbot that searches, retrieves and summarises Philippine legal materials (court decisions, statutes, issuances and related documents), backed by retrieval-augmented generation (RAG) techniques.

Summary
- Server (Node.js) + client (Vite) UI
- Uses Postgres + pgvector for embeddings and search


Quick start (development)
1. Copy `.envrc.template` -> `.envrc` and update values (do not commit secrets).
2. Start the dev stack (bind-mounts + watcher):
   ```bash
   make dev-up
   # follow logs
   make dev-logs
   ```
3. Stop dev stack:
   ```bash
   make dev-down
   ```

   Getting started — local setup
   ----------------------------

   1) Prerequisites

   - Node.js (LTS recommended; project has an `.nvmrc` you can use with nvm)
   - npm
   - Docker & docker compose
   - make

   2) Install dependencies

   At the repository root (server + tooling):

   ```bash
   npm install
   ```

   In the browser client directory (separate package):

   ```bash
   cd client
   npm install
   # install/activate client hooks
   npm run prepare
   ```

   3) Husky (git hooks)

   The repo contains husky hooks in `client/` (husky v9.x is declared in `client/package.json` and `client/.husky/`).

   There is a root-level `.husky/pre-commit` file too — if you want root-level hooks active, ensure Husky is installed at the repo root and run the prepare script:

   ```bash
   npm install --save-dev husky@^9
   npm run prepare
   ```

   If you'd prefer not to use root hooks, you may delete or ignore `.husky/` at the repository root to avoid confusion (the client still has its own hooks).

   4) Dev server & workflow

   - Start development stack (bind mount + nodemon):

   ```bash
   make dev-up
   make dev-logs    # follow logs
   ```

   - Start only the client for local UI development:

   ```bash
   cd client && npm run dev
   ```

   - Build the client for production:

   ```bash
   make build-client
   ```

   5) Database — create schema / import embeddings

   - Create DB schema locally (helpful for local testing):

   ```bash
   make setup-db
   # or use INPUT_FILE to import embeddings when available (recommended path on host: /rag-data)
   INPUT_FILE=/rag-data/embeddings.jsonl RAG_CORPUS_PATH=/rag-data/corpus make importer
   ```

   - Dump and restore helpers (run from the repository root):

   ```bash
   ./scripts/docker-pg-dump.sh -o ./dumps/my.dump.gz
   ./scripts/docker-pg-restore.sh -i ./dumps/my.dump.gz --create-db
   ```

   6) Linting and formatting

   - Run linter and auto-fix:

   ```bash
   make lint
   ```

   - Format the repo using Prettier:

   ```bash
   make format
   ```

   If pre-commit hooks are enabled, `lint-staged` will run these tasks automatically when committing.

   Using an existing /rag-data/ directory (recommended)
   -----------------------------------------------

Download the sample /rag-data bundle
----------------------------------

   If your host system already has a dataset at `/rag-data/` (for example shared on a VM or cloud host) containing:

   - `app-data/` (persistent app state),
   - `embeddings.jsonl` (precomputed embeddings), and
   - `corpus/` (text corpus)

   If you don't yet have a `/rag-data/` bundle to use, a curated sample dataset is available for download here:

   [Sample rag-data (drive)](https://drive.google.com/drive/folders/1pp5TWPsb_-vfxDCFhMCLFbR5qnA7CiTD?usp=sharing)

   This folder contains a recommended layout (app-data/, corpus/, embeddings.jsonl) so it can be mounted directly into your host at `/rag-data/` and used with the examples above. Keep any sensitive data out of public shares and verify contents before deploying.

   you can point the service and importer to those paths instead of duplicating data in the repo. The Docker compose setup supports three environment variables which are bound into the container:

   - `INPUT_FILE` -> host path to embeddings JSONL (mapped to `/app/input/embeddings.jsonl` inside the container)
   - `RAG_CORPUS_PATH` -> host path to the corpus root (mapped to `/app/corpus`)
   - `APP_DATA_PATH` -> host path to persistent application data (mapped to `/app/data`)

   Example `~/.envrc` or shell export when using `/rag-data`:

   ```bash
   export INPUT_FILE=/rag-data/embeddings.jsonl
   export RAG_CORPUS_PATH=/rag-data/corpus
   export APP_DATA_PATH=/rag-data/app-data
   ```

   Start the stack as normal and the containers will mount those host paths read-only where appropriate:

   ```bash
   make dev-up
   # or
   make up
   ```

   To run the importer using data from `/rag-data` explicitly:

   ```bash
   INPUT_FILE=/rag-data/embeddings.jsonl RAG_CORPUS_PATH=/rag-data/corpus make importer
   ```

   Using `/rag-data` keeps large datasets in a single shared place on the host, avoids copying large files into the repo, and makes it easier to reuse identical datasets across container runs.


Wipe dev volumes (destructive)
```bash
# WARNING: this will delete compose-managed volumes (including DB data)
WIPE=1 make dev-wipe
```

Licensing & third-party data
- Code in this repository is licensed MIT (see `LICENSE`).
- Some data is derived from the Lawphil Project and is subject to Creative Commons Attribution‑NonCommercial 4.0 (CC BY‑NC 4.0). See `client/src/modules/modal.js` and `third_party/` for attribution details.
- Additional contributions / processing by extra.bayanwat.ch are noted in `third_party/extra-bayanwat-ch/README.md`.

