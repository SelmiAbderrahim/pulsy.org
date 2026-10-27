# Pulsy — developer commands. Docker-first.
# --env-file makes the root .env the single source of truth for Compose
# interpolation (build args + ${VAR} substitutions).
COMPOSE := docker compose -f docker/docker-compose.yml --env-file .env

.PHONY: help start stop restart logs build shell-server shell-web shell-postgres migrate db-push generate seed seed-superadmin typecheck lint test custom-domains-install

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

start: ## Build + start the full stack (postgres, server, web)
	$(COMPOSE) up -d --build

stop: ## Stop the stack
	$(COMPOSE) down

restart: stop start ## Restart the stack

logs: ## Tail all service logs
	$(COMPOSE) logs -f

build: ## Build images without starting
	$(COMPOSE) build

shell-server: ## Shell into the server container
	$(COMPOSE) exec server sh

shell-web: ## Shell into the web container
	$(COMPOSE) exec web sh

shell-postgres: ## psql into the database
	$(COMPOSE) exec postgres psql -U pulsy -d pulsy

migrate: ## Apply committed SQL migrations (packages/db/drizzle)
	$(COMPOSE) exec server node packages/db/scripts/migrate.mjs

db-push: ## DEV ONLY — push the live schema without a migration (drizzle-kit push)
	$(COMPOSE) exec server sh -lc 'cd packages/db && ./node_modules/.bin/drizzle-kit push'

generate: ## Generate SQL migration files from the schema
	$(COMPOSE) exec server sh -lc 'cd packages/db && ./node_modules/.bin/drizzle-kit generate'

seed: ## Seed a demo user + example monitors
	$(COMPOSE) exec server ./apps/server/node_modules/.bin/tsx apps/server/src/seed.ts

seed-superadmin: ## Seed the superadmin from SUPERADMIN_* env (idempotent)
	$(COMPOSE) exec server ./apps/server/node_modules/.bin/tsx apps/server/src/seed-superadmin.ts

typecheck: ## Typecheck server/db in containers and web during Docker build
	$(COMPOSE) exec server sh -lc 'cd apps/server && ./node_modules/.bin/tsc --noEmit'
	$(COMPOSE) exec server sh -lc 'cd packages/db && ./node_modules/.bin/tsc --noEmit'
	$(COMPOSE) build web

lint: eslint-check ## Run ESLint policy and typechecks in rebuilt containers
	$(COMPOSE) exec server sh -lc 'cd apps/server && ./node_modules/.bin/tsc --noEmit'
	$(COMPOSE) exec server sh -lc 'cd packages/db && ./node_modules/.bin/tsc --noEmit'
	$(COMPOSE) build web

.PHONY: eslint-check
eslint-check: ## Enforce shared controls and themed-dialog policy
	$(COMPOSE) exec server ./node_modules/.bin/eslint . --max-warnings 0
	$(COMPOSE) exec server node --test scripts/check-eslint.test.mjs

test: ## Run server/db tests against an isolated DB and web tests during Docker build
	$(COMPOSE) exec postgres sh -lc 'dropdb --if-exists --force -U "$$POSTGRES_USER" "$${POSTGRES_DB}_test" && createdb -U "$$POSTGRES_USER" "$${POSTGRES_DB}_test"'
	$(COMPOSE) exec server sh -lc 'cd apps/server && DATABASE_URL="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@postgres:5432/$${POSTGRES_DB}_test" ./node_modules/.bin/vitest run'
	$(COMPOSE) exec server sh -lc 'cd packages/db && DATABASE_URL="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@postgres:5432/$${POSTGRES_DB}_test" ./node_modules/.bin/vitest run'
	$(COMPOSE) build web

custom-domains-install: ## Install the host custom-domain provisioner (systemd timer; needs root)
	sudo ops/custom-domains/install.sh

## CODE REVIEW GRAPH
#
# code-review-graph builds a Tree-sitter AST graph of the repo and stores it
# in .code-review-graph/graph.db (gitignored). It exposes MCP tools to AI
# assistants for blast-radius analysis, semantic search, and architecture
# queries — typically reducing review tokens by ~8x vs. raw file dumps.
#
# Requires Python 3.10+ on PATH (uvx resolves it). First-time use will
# download the toolchain.

.PHONY: graph-install graph-build graph-update graph-recheck graph-watch graph-status graph-changes graph-eval graph-viz graph-clean graph-help

graph-install: ## Install code-review-graph and configure MCP for detected AI tools
	@echo "Installing code-review-graph and wiring MCP servers..."
	@if command -v uvx >/dev/null 2>&1; then \
		uvx --python python3.11 code-review-graph install -y; \
	elif command -v pipx >/dev/null 2>&1; then \
		pipx install code-review-graph && code-review-graph install -y; \
	else \
		pip install --user code-review-graph && code-review-graph install -y; \
	fi

graph-build: ## Build the initial code review graph (first run downloads grammars; ~11s on this repo)
	@echo "Building code review graph (full re-parse)..."
	uvx --python python3.11 code-review-graph build

graph-update: ## Incremental re-index of changed files vs HEAD~1 (fast, <2s typical)
	@echo "Updating code review graph..."
	uvx --python python3.11 code-review-graph update

graph-recheck: ## Force a full rescan of the codebase (slower than graph-update)
	@echo "Re-scanning entire codebase..."
	uvx --python python3.11 code-review-graph build

graph-watch: ## Continuous watch mode: keep the graph fresh as files change
	uvx --python python3.11 code-review-graph watch

graph-status: ## Print graph statistics (nodes, edges, languages, last update)
	uvx --python python3.11 code-review-graph status

graph-changes: ## Change-impact + token-savings vs HEAD~1 (override with BASE=<git-ref>)
	uvx --python python3.11 code-review-graph detect-changes --brief $(if $(BASE),--base $(BASE),)

graph-eval: ## Run the token-reduction / impact / search-quality benchmarks
	uvx --python python3.11 code-review-graph eval --all

graph-viz: ## Generate the interactive HTML graph visualization (.code-review-graph/)
	uvx --python python3.11 code-review-graph visualize

graph-clean: ## Remove the local graph database (next build will be from scratch)
	rm -rf .code-review-graph

graph-help: ## Show code-review-graph CLI help
	uvx --python python3.11 code-review-graph --help

.PHONY: audit-private-targets
audit-private-targets: ## Read-only audit of stored destinations against strict egress policy
	$(COMPOSE) exec server ./apps/server/node_modules/.bin/tsx apps/server/src/audit-private-targets.ts

.PHONY: server-health-check
server-health-check: start ## Rebuild and check server health against an isolated test database
	$(COMPOSE) exec server sh -lc 'cd apps/server && ./node_modules/.bin/tsc --noEmit'
	$(COMPOSE) exec postgres sh -lc 'dropdb --if-exists --force -U "$$POSTGRES_USER" "$${POSTGRES_DB}_server_health_test" && createdb -U "$$POSTGRES_USER" "$${POSTGRES_DB}_server_health_test"'
	$(COMPOSE) exec server sh -lc 'cd apps/server && DATABASE_URL="postgres://$$POSTGRES_USER:$$POSTGRES_PASSWORD@postgres:5432/$${POSTGRES_DB}_server_health_test" ./node_modules/.bin/vitest run server-health agent-release-route'

.PHONY: agent-format agent-check agent-build agent-install-check agent-compose-check
agent-format: ## Format Go sources in the pinned Docker toolchain
	docker build -f docker/Dockerfile.agent --target toolchain -t pulsy-agent-toolchain .
	docker run --rm -v "$(CURDIR)/agent:/src/agent" pulsy-agent-toolchain gofmt -w .

agent-check: ## Vet and test the agent in Docker
	docker build -f docker/Dockerfile.agent --target check -t pulsy-agent-check .

agent-build: ## Export reproducible Linux amd64/arm64 binaries and checksums
	docker build -f docker/Dockerfile.agent --target artifacts --output type=local,dest=artifacts/agent .

agent-install-check: agent-build ## Exercise the real installer and systemd in disposable Linux
	docker build -f docker/Dockerfile.agent-install-test -t pulsy-agent-install-test .
	@set -eu; fixture=$$(docker run -d --cgroupns private --cap-add SYS_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined --tmpfs /run --tmpfs /run/lock --tmpfs /tmp --tmpfs /sys/fs/cgroup -v "$(CURDIR)/artifacts/agent:/artifacts:ro" pulsy-agent-install-test); trap 'docker rm -f "$$fixture" >/dev/null' EXIT; docker exec "$$fixture" python3 /test/installer_test.py

AGENT_FIXTURE_COMPOSE := PULSY_SOURCE_DIR="$(CURDIR)" docker compose --env-file .env --project-directory "$(CURDIR)/artifacts/agent-compose" -p pulsy-agent-install-fixture -f "$(CURDIR)/docker/docker-compose.agent-install-test.yml"
agent-compose-check: agent-build ## Run the installer-generated Compose agent with host metrics
	mkdir -p artifacts/agent-compose
	rm -f artifacts/agent-compose/ready
	@set -eu; trap '$(AGENT_FIXTURE_COMPOSE) -f "$(CURDIR)/artifacts/agent-compose/compose.yaml" down --remove-orphans >/dev/null 2>&1 || $(AGENT_FIXTURE_COMPOSE) down --remove-orphans >/dev/null' EXIT; $(AGENT_FIXTURE_COMPOSE) up -d --build --wait agent-receiver; $(AGENT_FIXTURE_COMPOSE) -f "$(CURDIR)/artifacts/agent-compose/compose.yaml" up -d pulsy-agent; $(AGENT_FIXTURE_COMPOSE) exec -T agent-receiver python3 /test/verify_compose.py
