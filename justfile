IMAGE := "chatly"

# Build the web client, then the Rust workspace (debug).
build: web
    cargo build

# Run the server in dev mode (serves web/dist from disk; rebuild `web` after client changes).
run: web
    cargo run

# Run all tests across the workspace.
test:
    cargo test --workspace

# Lint: fmt check + clippy with warnings denied.
lint:
    cargo fmt --all -- --check
    cargo clippy --workspace --all-targets -- -D warnings

# Regenerate docs/openapi.json from docs/api.md.
openapi:
    python3 scripts/gen-openapi.py

# Build the web client into web/dist.
web:
    cd web && npm install && npm run build

# Build the production Docker image.
docker:
    docker build -f docker/Dockerfile -t {{IMAGE}} .

# Run the image via docker compose.
up:
    docker compose -f docker/docker-compose.yml up -d --build

down:
    docker compose -f docker/docker-compose.yml down
