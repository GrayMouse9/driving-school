FROM node:22-alpine AS frontend-build
WORKDIR /src/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.22-alpine AS backend-build
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -o /out/server ./cmd/server

FROM alpine:3.21
WORKDIR /app
COPY --from=backend-build /out/server /app/server
COPY --from=frontend-build /src/frontend/dist /app/frontend/dist
COPY server-data/world/training-world.json /app/server-data/world/training-world.json
USER 65532:65532
CMD ["/app/server"]
