package realtime

import "testing"

func TestDecodeTelemetryRejectsInvalidValues(t *testing.T) {
	for _, input := range []string{
		`{"fps":-1,"ping":10}`,
		`{"fps":60,"ping":-1}`,
		`{"fps":60,"ping":10,"extra":true}`,
		`{"fps":60}`,
	} {
		if _, ok := decodeTelemetry([]byte(input)); ok {
			t.Errorf("accepted invalid telemetry %s", input)
		}
	}
	if got, ok := decodeTelemetry([]byte(`{"fps":60,"ping":24}`)); !ok || got.FPS != 60 || got.Ping != 24 {
		t.Fatalf("valid telemetry rejected: %+v, %v", got, ok)
	}
}
