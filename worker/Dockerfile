# ---------- BUILD STAGE ----------
FROM golang:1.24.5 AS builder

WORKDIR /app

# download dependencies first (better caching)
COPY go.mod go.sum ./
RUN go mod download

# copy rest of source
COPY . .

# build worker binary
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o worker .


# ---------- RUNTIME STAGE ----------
FROM debian:bookworm-slim

WORKDIR /app

# install ffmpeg for tempo rendering
RUN apt-get update \
    && apt-get install -y ffmpeg aubio-tools ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# copy compiled binary
COPY --from=builder /app/worker .

# create folders (mounted in docker-compose)
RUN mkdir -p /data/uploads /data/outputs

CMD ["./worker"]