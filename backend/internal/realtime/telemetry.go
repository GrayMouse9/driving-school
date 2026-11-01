package realtime

import (
	"bytes"
	"encoding/json"
	"io"
)

type telemetry struct {
	FPS  int `json:"fps"`
	Ping int `json:"ping"`
}

// handler: проверяет показатели, полученные от игрового клиента.
func decodeTelemetry(data []byte) (telemetry, bool) {
	var raw struct {
		FPS  *int `json:"fps"`
		Ping *int `json:"ping"`
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&raw) != nil || raw.FPS == nil || raw.Ping == nil || *raw.FPS < 0 || *raw.FPS > 1000 || *raw.Ping < 0 || *raw.Ping > 30000 || decoder.Decode(new(any)) != io.EOF {
		return telemetry{}, false
	}
	return telemetry{FPS: *raw.FPS, Ping: *raw.Ping}, true
}
