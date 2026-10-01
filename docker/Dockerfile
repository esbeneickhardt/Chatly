# syntax=docker/dockerfile:1

# ---- Stage 1: web client ----
FROM node:24-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/public ./public
COPY web/src ./src
RUN npm run build

# ---- Stage 2: rust binary (musl, statically linked) ----
FROM rust:1.98-alpine AS server
RUN apk add --no-cache musl-dev build-base
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY crates ./crates
COPY --from=web /web/dist ./web/dist
RUN cargo build --release --bin chatly && \
    strip target/release/chatly

# ---- Stage 3: runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /app/target/release/chatly /chatly
ENV DATA_DIR=/data
ENV LISTEN_ADDR=0.0.0.0:8080
EXPOSE 8080
EXPOSE 50000/udp
VOLUME ["/data"]
USER nonroot:nonroot
ENTRYPOINT ["/chatly"]
