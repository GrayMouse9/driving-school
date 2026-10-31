package test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	server "driving-school/server"
)

func TestValidateCredentials(t *testing.T) {
	tests := []struct {
		username, password string
		valid              bool
	}{
		{" Анна ", "password", true},
		{" ", "password", false},
		{"Анна", "short", false},
		{"Анна", "1234567890123456", false},
		{"Анна", " пароль ", true},
		{"12345678901234567890123456789012345678901", "password", false},
	}
	for _, tt := range tests {
		body, err := json.Marshal(map[string]string{"username": tt.username, "password": tt.password})
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		server.NewHandler(nil).ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader(body)))
		expected := http.StatusBadRequest
		if tt.valid {
			expected = http.StatusServiceUnavailable
		}
		if response.Code != expected {
			t.Errorf("credentials %q, %q: got %d, want %d", tt.username, tt.password, response.Code, expected)
		}
	}
}
