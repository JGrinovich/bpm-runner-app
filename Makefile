.PHONY: dev backend frontend

dev: backend frontend

backend:
	cd backend && npm run start

frontend:
	cd frontend && npm run dev -- --host
