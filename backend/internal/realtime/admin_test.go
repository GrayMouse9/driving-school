package realtime

import (
	"driving-school/backend/internal/storage"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAdminEndpointsRequireAuthentication(t *testing.T) {
	for _, path := range []string{"/api/v1/admin/state", "/api/v1/admin/prompt"} {
		rec := httptest.NewRecorder()
		NewHandler(nil).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
		if rec.Code != http.StatusUnauthorized {
			t.Errorf("%s: got %d, want 401", path, rec.Code)
		}
	}
}

func TestLocationChoiceRejectsUnknownAndOtherOccupants(t *testing.T) {
	statuses := []storage.LocationStatus{{ID: "one", Occupants: []storage.LocationOccupant{{PlayerID: "other"}}}, {ID: "two", Occupants: []storage.LocationOccupant{{PlayerID: "self"}}}, {ID: "three"}}
	if locationAvailable(statuses, "missing", "self") || locationAvailable(statuses, "one", "self") {
		t.Fatal("unknown or occupied location accepted")
	}
	if !locationAvailable(statuses, "two", "self") || !locationAvailable(statuses, "three", "self") {
		t.Fatal("current or empty location rejected")
	}
}
