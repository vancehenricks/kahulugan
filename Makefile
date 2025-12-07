DC = docker compose -f docker-compose.yml

POSTGRES_USER	?= postgres
POSTGRES_DB	?= ragdb
INPUT_FILE	?= rag-data/embeddings.jsonl

.PHONY: help build up down restart logs psql importer rebuild clean server build-client client-dev lint format copy-files dev-up dev-down dev-logs dev-shell

help:
	@echo "Usage:"
	@echo "  make build            Build docker images"
	@echo "  make up               Start production services (detached)"
	@echo "  make down             Stop production services"
	@echo "  make restart          Restart production services"
	@echo "  make logs             Follow logs for postgres and app"
	@echo "  make psql             Open psql shell on production postgres"
	@echo "  make importer         Start importer (detached). Uses Compose profile 'importer' and runs scripts/setup-db.mjs; not started by default with 'make up'"
	@echo "  make setup-db         Run scripts/setup-db.mjs locally (useful for local testing)"
	@echo "  make rebuild          Down, build, and bring up services"
	@echo "  make clean            Stop and remove containers, networks, volumes"
	@echo "  make server           Start the development server (watch mode)"
	@echo "  make build-client     Build the rag-client application"
	@echo "  make client-dev       Start the rag-client in development mode"
	@echo "  make lint             Run ESLint on the repo (fixes where possible)"
	@echo "  make format           Run Prettier to format source files"
	@echo "  make dev-up           Start dev-compose and run nodemon inside the dev container (detached)"
	@echo "  make dev-shell        Open an interactive shell inside the dev container"
	@echo "  make dev-wipe         Stop dev compose and remove dev volumes (destructive - requires WIPE=1)"

build:
	$(DC) build

up:
	$(DC) up -d --build

build-client:
	@echo "Building rag-client..."
	cd client && npm run build

server: build-client
	cd . && node --watch server.mjs

client-dev:
	@echo "Starting rag-client in development mode..."
	cd client && npm run dev

down:
	$(DC) down

dev-up:
	@echo "Starting dev compose (bind-mount local directory into app)"
	# Use a single compose file and enable the 'dev' profile to start app-dev
	docker compose -f docker-compose.yml --profile dev up -d --build app-dev postgres
	@echo "Starting nodemon inside app-dev (detached)"
	# run nodemon (npm run dev) in the dev container in detached/background mode so dev-up returns
	docker compose -f docker-compose.yml --profile dev exec -d --user node app-dev npm run dev || true

restart: down up

logs:
	$(DC) logs -f postgres app

dev-down:
	@echo "Stopping dev compose"
	docker compose -f docker-compose.yml --profile dev down

psql:
	@echo "Opening psql (user=$(POSTGRES_USER) db=$(POSTGRES_DB))..."
	$(DC) exec postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB)

dev-logs:
	@echo "Following dev logs (app-dev+postgres)"
	docker compose -f docker-compose.yml --profile dev logs -f app-dev postgres


dev-shell:
	@echo "Opening interactive shell inside app-dev"
	docker compose -f docker-compose.yml --profile dev exec app-dev /bin/bash

dev-wipe:
	@echo "\n!!! DESTRUCTIVE: This will stop the dev compose services and REMOVE the compose-managed volumes (including postgres-data). !!!\n"
	@echo "To proceed set WIPE=1 (example: WIPE=1 make dev-wipe)"
	@if [ "$(WIPE)" != "1" ]; then echo "Aborting: WIPE not set (to wipe, run: WIPE=1 make dev-wipe)"; exit 1; fi
	@echo "Stopping dev compose and removing volumes..."
	docker compose -f docker-compose.yml --profile dev down -v --remove-orphans || true
	@echo "Done. Volumes declared in docker-compose.yml (including postgres-data) were removed.\n"
	
importer:
	@echo "Starting importer (setup-db) detached — INPUT_FILE=$(INPUT_FILE)"
	@echo "The importer will run in the background; follow logs with '$(DC) logs -f importer'"
	INPUT_FILE=$(INPUT_FILE) RAG_CORPUS_PATH=$(RAG_CORPUS_PATH) $(DC) run --rm -d importer || true

rebuild:
	$(DC) down
	$(DC) build
	$(DC) up -d

clean:
	$(DC) down -v --remove-orphans

lint:
	@echo "Running ESLint..."
	npx eslint . --ext .js,.mjs --fix

format:
	@echo "Running Prettier..."
	npx prettier --write "**/*.{js,mjs,json,css,md}"
