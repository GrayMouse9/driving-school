package realtime

import (
	"driving-school/backend/internal/player"
	"driving-school/backend/internal/world"
	"os"
	"testing"
)

func TestYieldWithoutPrimaryPlayerCanContinue(t *testing.T) {
	g := &game{players: map[string]*gamePlayer{}, sharedAnswers: map[string]bool{}}
	if !g.primaryClear() {
		t.Fatal("no primary car is present: yielding must not wait forever")
	}
	p := &gamePlayer{training: &trainingState{Role: "P", LocationID: "shared-priority-p"}, car: player.Vehicle{X: 34.5, Z: 42}}
	g.players["p"] = p
	if g.primaryClear() {
		t.Fatal("must yield to a primary car at the intersection")
	}
	p.training.SharedPassed = true
	p.car.X = 23
	if !g.primaryClear() {
		t.Fatal("must continue once primary car clears the junction")
	}
}

func TestPrimaryAutomaticRouteCanLeaveCheckpoint(t *testing.T) {
	data, err := os.ReadFile("../../../server-data/world/training-world.json")
	if err != nil {
		t.Fatal(err)
	}
	w, err := world.Load(data)
	if err != nil {
		t.Fatal(err)
	}
	var roads, obstacles []player.CollisionBox
	var route []player.Point
	for _, chunk := range w.Chunks {
		roads = append(roads, chunk.Roads...)
		obstacles = append(obstacles, chunk.Obstacles...)
		if chunk.Teaching != nil {
			for _, p := range chunk.Teaching.Paths {
				if p.ID == "shared-p-left" {
					route = p.Points
				}
			}
		}
	}
	car := player.Vehicle{X: 34.5, Z: 42}
	index := player.RouteIndex(car, route)
	for i := 0; i < 500; i++ {
		car, index = player.FollowRoute(car, route, index, obstacles, roads, .05)
	}
	if car.X >= 24 {
		t.Fatalf("primary car stuck on actual world route: %+v index %d", car, index)
	}
}
