package player

import (
	"math"
	"testing"
)

func TestCheckpointAndAutomaticRoadRoute(t *testing.T) {
	zone := []Point{{X: -2, Z: -2}, {X: 2, Z: -2}, {X: 2, Z: 2}, {X: -2, Z: 2}}
	if !InZone(0, 0, zone) || InZone(3, 0, zone) {
		t.Fatal("checkpoint bounds")
	}
	roads := []CollisionBox{{Width: 12, Length: 128}}
	route := []Point{{X: 2.5, Z: 20}, {X: 2.5, Z: 10}, {X: 2.5, Z: 0}}
	car := Vehicle{X: 2.5, Z: 20}
	index := 1
	for i := 0; i < 150; i++ {
		car, index = FollowRoute(car, route, index, nil, roads, .05)
	}
	if index != len(route) || math.Abs(car.Z) > .001 || car.Speed != 0 {
		t.Fatalf("route did not stop: %+v %d", car, index)
	}
	car = Vehicle{X: 2.5, Z: 20}
	index = 1
	for i := 0; i < 100; i++ {
		car, index = FollowRoute(car, route, index, []CollisionBox{{X: 2.5, Z: 10, Width: 2, Length: 2}}, roads, .05)
	}
	if car.Z < 13 || index >= len(route) {
		t.Fatalf("route drove through an obstacle: %+v", car)
	}
}
