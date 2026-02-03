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
