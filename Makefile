.PHONY: install build dev typecheck test coverage docker-up docker-down deploy token

# One-command replicability: install -> test -> build -> run
install:
	npm ci

build:
	npm run build

dev:
	npm run dev

typecheck:
	npm run typecheck

test:
	npm run typecheck && npm test

coverage:
	npm run coverage

docker-up:
	docker compose up -d --build

docker-down:
	docker compose down

deploy:
	./scripts/deploy.sh

# Generate a test JWT: make token USER_ID=alice
token:
	npx ts-node scripts/gen-token.ts $(USER_ID)
