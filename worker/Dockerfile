FROM golang:1.24.5 AS build
WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o worker ./main.go

FROM alpine:3.20
WORKDIR /app
COPY --from=build /app/worker /app/worker
CMD ["/app/worker"]
