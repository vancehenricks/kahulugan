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

Wipe dev volumes (destructive)
```bash
# WARNING: this will delete compose-managed volumes (including DB data)
WIPE=1 make dev-wipe
```

Licensing & third-party data
- Code in this repository is licensed MIT (see `LICENSE`).
- Some data is derived from the Lawphil Project and is subject to Creative Commons Attribution‑NonCommercial 4.0 (CC BY‑NC 4.0). See `client/src/modules/modal.js` and `third_party/` for attribution details.
- Additional contributions / processing by extra.bayanwat.ch are noted in `third_party/extra-bayanwat-ch/README.md`.

