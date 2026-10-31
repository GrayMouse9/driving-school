package test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/coder/websocket"
)

func fixtureWithObstacle(t *testing.T, data []byte) []byte {
	t.Helper()
	var world map[string]any
	if err := json.Unmarshal(data, &world); err != nil {
		t.Fatal(err)
	}
	found := false
	for _, raw := range world["chunks"].([]any) {
		chunk := raw.(map[string]any)
		if chunk["id"] != "c_0_0" {
			continue
		}
		object := map[string]any{
			"id": "test-obstacle", "kind": "building",
			"position": map[string]any{"x": 27, "y": 0, "z": 26},
			"yaw":      0, "size": map[string]any{"x": 2, "y": 2, "z": 2},
			"color": "#ffffff", "collidable": true,
		}
		chunk["objects"] = append(chunk["objects"].([]any), object)
		found = true
		break
	}
	if !found {
		t.Fatal("expected test chunk")
	}
	encoded, err := json.Marshal(world)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func checkPhysics(t *testing.T, ctx context.Context, driver, observer *websocket.Conn, driverID string) {
	t.Helper()
	for _, input := range []string{
		`{"v":1,"type":"player_input","payload":{"seq":2,"throttle":2,"brake":0,"steer":0}}`,
		`{"v":1,"type":"player_input","payload":{"seq":2,"throttle":0,"brake":0,"steer":-2}}`,
	} {
		if err := driver.Write(ctx, websocket.MessageText, []byte(input)); err != nil {
			t.Fatal(err)
		}
		for {
			_, data, err := driver.Read(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var message struct {
				Type    string `json:"type"`
				Payload struct {
					Code string `json:"code"`
				} `json:"payload"`
			}
			if err := json.Unmarshal(data, &message); err != nil {
				t.Fatal(err)
			}
			if message.Type == "server_error" {
				if message.Payload.Code != "INVALID_MESSAGE" {
					t.Fatalf("invalid control: %s", data)
				}
				break
			}
		}
	}
	if err := driver.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"player_input","payload":{"seq":2,"throttle":0,"brake":0,"steer":0}}`)); err != nil {
		t.Fatal(err)
	}
	for {
		_, data, err := driver.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var message struct {
			Type    string `json:"type"`
			Payload struct {
				Ack      int64 `json:"ackInputSeq"`
				Vehicles []struct {
					ID    string  `json:"id"`
					Speed float64 `json:"speed"`
				} `json:"vehicles"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type != "players_snapshot" || message.Payload.Ack < 2 {
			continue
		}
		for _, v := range message.Payload.Vehicles {
			if v.ID == "vehicle-"+driverID && v.Speed == 0 {
				goto stopped
			}
		}
	}
stopped:
	sentAt := time.Now().UnixMilli()
	if err := driver.Write(ctx, websocket.MessageText, []byte(`{"v":1,"type":"player_input","payload":{"seq":3,"throttle":1,"brake":0,"steer":0}}`)); err != nil {
		t.Fatal(err)
	}
	moving := false
	for {
		_, data, err := observer.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var message struct {
			Type    string `json:"type"`
			Payload struct {
				ServerTime int64 `json:"serverTime"`
				Vehicles   []struct {
					ID       string  `json:"id"`
					Speed    float64 `json:"speed"`
					Position struct {
						Z float64 `json:"z"`
					} `json:"position"`
				} `json:"vehicles"`
			} `json:"payload"`
		}
		if err := json.Unmarshal(data, &message); err != nil {
			t.Fatal(err)
		}
		if message.Type != "players_snapshot" || message.Payload.ServerTime < sentAt {
			continue
		}
		for _, v := range message.Payload.Vehicles {
			if v.ID != "vehicle-"+driverID {
				continue
			}
			if v.Speed > 0 {
				moving = true
			}
			if moving && v.Speed == 0 {
				if v.Position.Z < 29.09 {
					t.Fatalf("vehicle entered obstacle: %s", data)
				}
				return
			}
		}
	}
}
