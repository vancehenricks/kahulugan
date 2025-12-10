# Copilot Instructions for Kahulugan

These guidelines help AI coding agents work productively in this repo. Focus on existing patterns and workflows; avoid speculative changes.

## Big Picture
- **Purpose:** AI-powered legal research chatbot for Philippine legal materials using RAG over a precomputed corpus.
- **Runtime:** Node.js services orchestrated via Docker Compose; browser client served by the server.
- **Data:** External `/rag-data` mount with `corpus/`, `embeddings.jsonl`, and `app-data/` (persistent state).
- **LLM Access:** Uses OpenRouter; requires `OPENROUTER_KEY`.

## Key Directories & Files
- Root:
  - `server.mjs`: Server entry; coordinates HTTP and WebSocket.
  - `docker-compose.yml`, `Makefile`: Primary run/dev workflow (see below).
  - `README.md`: Setup + run commands (authoritative).
- Server logic (`src/`):
  - `server/`: request/WS routing, rate limiting, and handlers.
    - `requestRouter.mjs`: Maps HTTP routes to handlers.
    - `wsHandler.mjs`: WebSocket bootstrap; delegates to `wsHandlers/*`.
    - `handlers/`: HTTP handlers (files, static assets, suggestions).
    - `wsHandlers/`: WebSocket handlers for `analysis`, `qa`, `search`.
  - `search/`: RAG search — law name extraction, scoring, snippet extraction.
  - `questionAndAnswer/`: Q&A orchestration with the LLM and retrieved context.
  - `perspectiveAnalysis/`: Multi-agent style pipeline (researcher, planner, presenter).
  - `formatter/`: Output cleaning (encoding artifacts, character recovery, formatter).
  - `utils/`: Shared utilities (file fetch, downsampling, etc.).
- Client (`client/`):
  - `src/modules/*`: UI modules for chat messages, sending, file viewer, modal.
  - `src/utils/`: DOM helpers and message parsing.
  - `public/` + `styles/`: assets and CSS.

## Data Flow & Boundaries
- **Web UI → WebSocket:** Client sends chat/search requests; server `wsHandler` routes by message type to `wsHandlers/{qa,search,analysis}`.
- **WS Handler → Pipeline:** Handler builds context from `src/context.mjs`, fetches corpus snippets via `src/search/search.mjs`, then invokes LLM via `src/llm.mjs`.
- **RAG:** `src/search/*` retrieves candidates from `embeddings.jsonl` and corpus, scores with `scoring.mjs`, extracts snippets via `snippetExtractors.mjs` and `extractors/*`.
- **Q&A:** `src/questionAndAnswer/questionAndAnswer.mjs` merges user question, retrieved context, and formatting via `formatter/formatter.mjs` before sending.
- **Responses:** Formatter modules clean artifacts, then server streams messages back over WS; client modules render via `chatMessageUI.js` and `chatMessages.js`.

## Conventions & Patterns
- **Module style:** ES modules (`.mjs`) on server, standard `import`/`export` with small, focused files; avoid side effects at import time.
- **WS messages:** Distinct handlers per feature; keep payload schemas explicit and validated in handler utilities (`wsHandlers/utils.mjs`).
- **RAG selection:** Prefer `search/search.mjs` entry rather than calling extractors directly. Use `lawNameExtractors.mjs` and `snippetExtractors.mjs` through orchestrators.
- **Formatting:** Always run responses through `formatter/formatter.mjs` and artifact recovery modules.
- **Rate limiting:** Respect `server/rateLimiter.mjs` when adding endpoints.
- **Paths:** Access `/rag-data` via env-configured absolute paths; do not hardcode local dev paths.

## Critical Workflows
- **Setup:**
  - Ensure `/rag-data` exists with `embeddings.jsonl` and `corpus/`.
  - Set `OPENROUTER_KEY` and related paths in `.envrc` (use `direnv`).
- **Install:**
  ```bash
  npm install
  cd client && npm install && npm run prepare
  ```
- **Run (Docker):**
  ```bash
  make up
  make logs
  make down
  ```
- **DB utilities:** Postgres Dockerfiles and init SQL under `docker/postgres/`; use scripts in `scripts/` (`docker-pg-dump.sh`, `docker-pg-restore.sh`) and `scripts/setup-db.mjs` as needed.

## Integration Points
- **OpenRouter:** `src/llm.mjs` handles LLM calls; keep prompts modular in `perspectiveAnalysis/*` and `questionAndAnswer/*`.
- **File Serving:** `src/server/handlers/staticHandler.mjs` for client assets; `fileHandler.mjs` for file endpoints.
- **Suggestions:** `src/suggestions/suggestions.mjs` via `handlers/suggestionsHandler.mjs`.

## When Implementing Changes
- **Add server routes:** Register in `requestRouter.mjs`; if WS, add a new `wsHandlers/<feature>.mjs` with a clear message schema.
- **Extend search/RAG:** Add new extractors under `search/extractors/*`, then wire through `snippetExtractors.mjs` and scoring.
- **Client features:** Create a module in `client/src/modules/` and integrate with `main.js`; keep DOM ops in `client/src/utils/dom.js`.
- **Env/config:** Update `.envrc.template` if adding required variables; assume direnv usage.

## Examples
- **Q&A entry point:** `src/questionAndAnswer/questionAndAnswer.mjs` consumes a question, calls `search/search.mjs` for context, formats via `formatter/formatter.mjs`, and streams LLM output through `wsHandlers/qaHandler.mjs`.
- **Search flow:** `wsHandlers/searchHandler.mjs` → `search/search.mjs` → `scoring.mjs` → `snippetExtractors.mjs` → return ranked snippets.

## Guardrails
- Avoid changing how `/rag-data` paths resolve; rely on env vars.
- Preserve streaming semantics in WS handlers; don’t buffer entire responses.
- Keep modules cohesive; prefer adding files over expanding large ones.

If any area is unclear (e.g., env var names, WS payload schemas, or DB usage), tell us and we’ll refine these instructions.
