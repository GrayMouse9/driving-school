package test

import (
	server "driving-school/backend/internal/realtime"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestUnauthenticatedProfile(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/api/v1/profile", nil)
	response := httptest.NewRecorder()
	server.NewHandler(nil).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("got status %d, want 401", response.Code)
	}
}

func TestRegisterRejectsInvalidPassword(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", strings.NewReader(`{"username":"Анна","password":"short"}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	server.NewHandler(nil).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", response.Code)
	}
	if len(response.Result().Cookies()) != 0 {
		t.Fatal("invalid registration must not create a session")
	}
}

func TestLoginRejectsInvalidCredentialsFormat(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"username":"Анна","password":"x"}`))
	response := httptest.NewRecorder()
	server.NewHandler(nil).ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest {
		t.Fatalf("got status %d, want 400", response.Code)
	}
}

func TestLogoutRequiresSession(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", strings.NewReader(`{}`))
	response := httptest.NewRecorder()
	server.NewHandler(nil).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("got status %d, want 401", response.Code)
	}
}

func TestHealthReportsUnavailableDatabase(t *testing.T) {
	response := httptest.NewRecorder()
	server.NewHandler(nil).ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v1/health", nil))
	if response.Code != http.StatusServiceUnavailable || !strings.Contains(response.Body.String(), `"degraded"`) {
		t.Fatalf("got %d %s, want degraded health", response.Code, response.Body.String())
	}
}

func TestWebsocketRequiresSessionBeforeUpgrade(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/ws", nil)
	request.Header.Set("Connection", "Upgrade")
	request.Header.Set("Upgrade", "websocket")
	response := httptest.NewRecorder()
	server.NewHandler(nil).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("got status %d, want 401 before upgrade", response.Code)
	}
}
