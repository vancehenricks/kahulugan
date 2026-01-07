# Copilot Instructions for Kahulugan

Concise, actionable guidance to get an AI coding agent productive quickly.

## Big picture
- Purpose: RAG-based legal research chatbot (Philippine law) — server (Node.js) + browser client.
- Data: Host corpus and precomputed vectors at `/rag-data` (must contain `corpus/`, `embeddings.jsonl`, `app-data`).
- LLM: Uses OpenRouter (set `OPENROUTER_KEY`); embeddings via `qwen/qwen3-embedding-8b` in `src/llm.mjs`.

## Key places to look (examples)
- Entry points: `server.mjs` (HTTP + WebSocket bootstrap), `client/src/main.js` (frontend).
- RAG/search: `src/search/search.mjs`, `search/scoring.mjs`, `search/snippetExtractors.mjs`, `search/extractors/*`.
- Q&A & prompts: `src/questionAndAnswer/questionAndAnswer.mjs` and `src/perspectiveAnalysis/*` (researcher, planner, presenter).
- Output cleaning: `src/formatter/formatter.mjs` (character recovery, artifact filtering) — always use this before returning text to clients.
- Websockets: `src/server/wsHandler.mjs` routes message types `search`, `qa`, `perspective-analysis` to `wsHandlers/*`.
- DB/importer: `scripts/setup-db.mjs` and `Makefile` targets (see `make importer` / `INPUT_FILE` env).

## Conventions & patterns (repo-specific)
- Use ES modules (`.mjs`) for server files; avoid side-effects at import time.
- Prefer small focused modules (follow existing `perspectiveAnalysis` split: generator/verifier/partyIdentifier/presenter).
- Streaming semantics: WS handlers stream responses; **do not** buffer whole responses in memory — preserve streaming behavior.
- Always pass model outputs through `src/formatter/*` and, when applicable, `responseVerifier.mjs` in `perspectiveAnalysis`.
- File citations: use helpers like `extractSource()` and `renumberInlineCitations()` in `presenter.mjs` when emitting FILE: tokens.
- DB vector index: `scripts/setup-db.mjs` may downsample embeddings and chooses whether to create IVFFLAT index — respect `DOWNSAMPLE_DIM` / `PGVECTOR_CREATE_INDEX`.

## How to add common features (step-by-step)
- Add a new WebSocket feature:
  1) Create `src/server/wsHandlers/<feature>.mjs` exporting a clear async handler.
  2) Import and route it in `src/server/wsHandler.mjs` (add message type and validation).
  3) Add tests/manual checks using `make dev-up`, `make dev-shell`, and `make logs`.

- Add a new extractor/snippet:
  1) Create under `src/search/extractors/`.
  2) Wire via `search/snippetExtractors.mjs` and `search/search.mjs`.
  3) Verify output formatting with `src/formatter/formatter.mjs`.

## Developer workflows & useful commands
- Local dev (docker):
  - Start: `make up` (or `make dev-up` for bind-mounted dev container)
  - Tail logs: `make logs` / `make dev-logs`
  - Shell in dev container: `make dev-shell`
- Import embeddings: `make importer` or run `INPUT_FILE=./path node scripts/setup-db.mjs`.
- Lint/format: `make lint` / `make format`.
- Run server locally without docker: `npm run dev` (nodemon) or `npm start`.

## Guardrails & gotchas
- Do not hardcode `/rag-data`; read via envs and `.envrc.template` (direnv recommended).
- Keep prompt text modular (prompts live in `perspectiveAnalysis/*` and `questionAndAnswer/*`).
- Preserve streaming/WS semantics — avoid replacing streaming with synchronous buffering.
- When modifying embeddings/DB schema, be mindful of index dimension limits (max ~2000 for IVFFLAT in `scripts/setup-db.mjs`).

---
If anything is missing or unclear here, tell me which sections you'd like expanded and I’ll iterate.