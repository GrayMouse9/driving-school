package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"driving-school/backend/internal/realtime"
	"driving-school/backend/internal/storage"
	_ "github.com/jackc/pgx/v5/stdlib"
)

func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	if err := db.PingContext(ctx); err != nil {
		cancel()
		log.Fatal("database unavailable")
	}
	if err := storage.InitSchema(ctx, db); err != nil {
		cancel()
		log.Fatal("database schema initialization failed")
	}
	cancel()
	address := os.Getenv("LISTEN_ADDR")
	if address == "" {
		address = ":8080"
	}
	clientDir := os.Getenv("CLIENT_DIR")
	if clientDir == "" {
		clientDir = "../frontend/dist"
	}
	worldFile := os.Getenv("WORLD_FILE")
	if worldFile == "" {
		log.Fatal("WORLD_FILE is required")
	}
	worldData, err := os.ReadFile(worldFile)
	if err != nil {
		log.Fatal("unable to read WORLD_FILE")
	}
	api, stopGame, err := realtime.NewGameHandler(db, worldData)
	if err != nil {
		log.Fatalf("unable to load world: %v", err)
	}
	defer stopGame()
	mux := http.NewServeMux()
	mux.Handle("/api/", api)
	mux.Handle("/ws", api)
	mux.HandleFunc("GET /admin/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/admin/" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, clientDir+"/index.html")
	})
	mux.Handle("/", http.FileServer(http.Dir(clientDir)))
	httpServer := &http.Server{Addr: address, Handler: mux, ReadHeaderTimeout: 5 * time.Second}
	shutdown, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-shutdown.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := httpServer.Shutdown(ctx); err != nil {
			log.Printf("shutdown: %v", err)
		}
	}()
	log.Printf("listening on %s", address)
	if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}
