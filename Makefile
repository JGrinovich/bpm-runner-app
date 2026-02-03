include .env
export

COMPOSE_FILE=infra/docker-compose.yml

.PHONY: dev up down logs ps frontend

dev: up frontend

up:
	docker compose --env-file .env -f $(COMPOSE_FILE) up -d --build
	@echo "✅ Docker services up"
	@echo "Backend health: http://localhost:8080/healthz"
	@echo "Tip: run 'make logs' in another terminal"

down:
	docker compose --env-file .env -f $(COMPOSE_FILE) down

logs:
	docker compose --env-file .env -f $(COMPOSE_FILE) logs -f --tail=200

ps:
	docker compose --env-file .env -f $(COMPOSE_FILE) ps

frontend:
	cd frontend && npm run dev -- --host

.PHONY: wait-db
wait-db:
	@echo "⏳ waiting for postgres..."
	@until docker exec bpm_postgres pg_isready -U $(POSTGRES_USER) -d $(POSTGRES_DB) >/dev/null 2>&1; do \
		sleep 1; \
	done
	@echo "✅ postgres ready"


.PHONY: migrate-up migrate-reset psql

migrate-up: wait-db
	docker exec -i bpm_postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) < infra/migrations/0001_init.sql
	@echo "✅ migrations applied"

migrate-reset: wait-db
	docker exec -i bpm_postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
	docker exec -i bpm_postgres psql -U $(POSTGRES_USER) -d $(POSTGRES_DB) < infra/migrations/0001_init.sql
	@echo "✅ database reset + migrations applied"
