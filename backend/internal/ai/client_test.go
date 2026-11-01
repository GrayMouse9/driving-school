package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCoachForwardsServerContextAndPlayerIdentity(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/coach/action" || r.Header.Get("X-Player-ID") != "authenticated-player" {
			t.Error("incorrect coach identity or endpoint")
		}
		var request Request
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
			t.Error(err)
		}
		if request.LocationID != "stop-no-line-k" || request.CorrectAnswer != "stop" || request.Answer != "left" {
			t.Errorf("lost authoritative location context: %+v", request)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"answer":"Остановитесь перед пересекаемой дорогой."}`))
	}))
	defer server.Close()
	result, err := NewClient(server.URL).Respond(context.Background(), "authenticated-player", Request{LocationID: "stop-no-line-k", CorrectAnswer: "stop", Answer: "left"}, true)
	if err != nil || result == "" {
		t.Fatalf("coach response: %q %v", result, err)
	}
}

func TestCoachRejectsEmptyAndFailedResponses(t *testing.T) {
	for _, status := range []int{200, 500} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(status); w.Write([]byte(`{"answer":""}`)) }))
			defer server.Close()
			if _, err := NewClient(server.URL).Respond(context.Background(), "player", Request{}, false); err == nil {
				t.Fatal("invalid reply accepted")
			}
		})
	}
}

func TestQuestionNeverSendsTheHiddenAnswer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if _, exists := body["correct_answer"]; exists {
			t.Error("ordinary question reveals the hidden correct answer to the model")
		}
		if body["description"] != "Поверните направо." {
			t.Error("instructor task missing")
		}
		w.Write([]byte(`{"answer":"Посмотрите на обстановку на перекрёстке."}`))
	}))
	defer server.Close()
	_, err := NewClient(server.URL).Respond(context.Background(), "player", Request{CorrectAnswer: "stop", Description: "Поверните направо.", Message: "Привет"}, false)
	if err != nil {
		t.Fatal(err)
	}
}
