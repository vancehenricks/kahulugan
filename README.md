# Kahulugan

AI-powered legal research chatbot for Philippine legal materials.


## Requirements

- Node.js (LTS) + npm, Docker, docker-compose, make
- Host dataset at `/rag-data` with:
	- `embeddings.jsonl` (precomputed embeddings)
	- `corpus/` (text corpus)
	- `app-data/` (persistent app state)
  The `corpus/` holds source documents, and `embeddings.jsonl` contains their precomputed vector embeddings used for search/RAG.
- OpenRouter subscription and API key. Set `OPENROUTER_KEY` (see auth docs: https://openrouter.ai/docs/api/reference/authentication)

- Recommended: `direnv` to automatically load `.envrc` in this repo.

Download `/rag-data` bundle:
- Google Drive: https://drive.google.com/drive/u/2/folders/1pp5TWPsb_-vfxDCFhMCLFbR5qnA7CiTD
- Extract to `/rag-data` on the host so paths match the env vars below.

---

## Setup

1) Environment

```bash
cp .envrc.template .envrc   # fill values (OPENROUTER_KEY, paths to /rag-data)
```

Recommended: load via direnv (auto-loads `.envrc` in this folder):

```bash
sudo apt-get update && sudo apt-get install -y direnv
echo 'eval "$(direnv hook bash)"' >> ~/.bashrc && source ~/.bashrc
direnv allow   # run in repo root once
```

If not using direnv, you can export variables manually in your shell.

2) Install dependencies

```bash
npm install                     # repo root (server + tooling)
cd client && npm install && npm run prepare
```

3) Optional: database + importer

```bash
make setup-db
INPUT_FILE=/rag-data/embeddings.jsonl RAG_CORPUS_PATH=/rag-data/corpus make importer
```


## Run

```bash
make up        # start containers + watchers
make logs      # follow logs
```

Stop:

```bash
make down
```

## License & data

- Code: MIT (see `LICENSE`)
- Corpus and `embeddings.jsonl`: derived from the Lawphil Project and distributed under CC BY-NC 4.0. See `rag-data/LICENSE` for the Lawphil license and attribution details

