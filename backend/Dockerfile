# Build stage
FROM golang:1.26-bookworm AS builder

# Set the working directory inside the container
WORKDIR /app

# Copy dependency definition files
COPY go.mod go.sum ./

# Download dependencies
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build the binary with CGO enabled (required for SQLite)
RUN CGO_ENABLED=1 GOOS=linux go build -ldflags="-w -s" -o dashboard-api ./cmd/api

# Final clean runtime stage
FROM debian:bookworm-slim

# Install ca-certificates and sqlite3 in case they are needed for migrations or https queries
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    sqlite3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy the built Go binary from the builder stage
COPY --from=builder /app/dashboard-api .

# Expose the port the app runs on
EXPOSE 8080

# Run the binary
CMD ["./dashboard-api"]
