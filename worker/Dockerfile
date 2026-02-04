FROM golang:1.24.5-bookworm AS build
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o worker ./main.go

FROM debian:bookworm-slim
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg aubio-tools ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/worker /app/worker
CMD ["/app/worker"]
