package realtime

import (
	"driving-school/backend/internal/player"
	"github.com/coder/websocket"
	"math"
	"testing"
)

func TestObserverTracksNearestConnectedCarWithoutMoving(t *testing.T) {
	g := &game{observers: []observer{{ID: "watcher", ChunkID: "chunk", X: 8, Z: 8}}, players: map[string]*gamePlayer{
		"near":    {car: player.Vehicle{X: 18, Z: 8}, conn: &websocket.Conn{}},
		"far":     {car: player.Vehicle{X: 8, Z: 28}, conn: &websocket.Conn{}},
		"offline": {car: player.Vehicle{X: 8, Z: 7}},
	}}
	for i := 0; i < 40; i++ {
		g.updateObservers(.1)
	}
	o := g.observers[0]
	if math.Abs(o.Yaw+75*math.Pi/180) > .001 {
		t.Fatalf("not looking at nearest active car: %v", o.Yaw)
	}
	if o.BodyYaw != 0 {
		t.Fatal("observer body rotated")
	}
	if o.X != 8 || o.Z != 8 {
		t.Fatal("stationary observer moved")
	}
	g.players["near"].car = player.Vehicle{X: 8, Z: -2}
	before := o.Yaw
	g.updateObservers(.1)
	if math.Abs(g.observers[0].Yaw-before) > .20001 {
		t.Fatal("observer snapped instead of smoothly turning")
	}
	for i := 0; i < 40; i++ {
		g.updateObservers(.1)
	}
	if math.Abs(g.observers[0].Yaw) > .001 {
		t.Fatal("observer did not follow the moved car")
	}
	delete(g.players, "near")
	delete(g.players, "far")
	before = g.observers[0].Yaw
	g.updateObservers(.1)
	if g.observers[0].Yaw != before {
		t.Fatal("observer follows an offline car")
	}
	if len(g.observerViews(map[string]bool{"another-chunk": true})) != 0 {
		t.Fatal("observer state leaked from unloaded location")
	}
}
