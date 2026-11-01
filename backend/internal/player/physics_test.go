package player

import (
	"math"
	"testing"
)

func TestReverseLeavesObstacleAndStopsOnRelease(t *testing.T) {
	car := Vehicle{Z: 3.11}
	obstacle := []CollisionBox{{Width: 2, Length: 2}}
	for i := 0; i < 40; i++ {
		car = Step(car, Input{Brake: 1}, obstacle, .05)
	}
	if car.Z <= 4 || car.Speed >= 0 || car.Speed < -3 {
		t.Fatalf("cannot reverse away from wall: %+v", car)
	}
	for i := 0; i < 40; i++ {
		car = Step(car, Input{}, obstacle, .05)
	}
	if math.Abs(car.Speed) > .001 {
		t.Fatalf("release must stop, including unfocused browser: %+v", car)
	}
}
func TestReverseCanEscapeExistingOverlap(t *testing.T) {
	car := Vehicle{Z: 3.05}
	for i := 0; i < 40; i++ {
		car = Step(car, Input{Brake: 1}, []CollisionBox{{Width: 2, Length: 2}}, .05)
	}
	if car.Z <= 4 {
		t.Fatalf("car remained trapped: %+v", car)
	}
}
func TestForwardStillCannotEnterWall(t *testing.T) {
	car := Vehicle{Z: 5}
	for i := 0; i < 80; i++ {
		car = Step(car, Input{Throttle: 1}, []CollisionBox{{Width: 2, Length: 2}}, .05)
	}
	if car.Z < 3.1 {
		t.Fatalf("entered wall: %+v", car)
	}
}

func TestRoadConstraintStopsTheWholeCarAtAsphaltEdge(t *testing.T) {
	roads := []CollisionBox{{Width: 12, Length: 64}}
	car := Vehicle{X: 3.5, Z: 0, Yaw: -math.Pi / 2, Speed: 6}
	for i := 0; i < 30; i++ {
		car = StepOnRoad(car, Input{Throttle: 1}, nil, roads, .05)
		if !OnRoad(car, roads) {
			t.Fatalf("car left asphalt: %+v", car)
		}
	}
	if car.X > 4.1 || car.Speed != 0 {
		t.Fatalf("front of eastbound car crossed the edge: %+v", car)
	}
}

func TestRoadConstraintCrossesConnectedChunksAndKeepsTheJunctionOpen(t *testing.T) {
	roads := []CollisionBox{{Z: 0, Width: 12, Length: 64}, {Z: -64, Width: 12, Length: 64}, {Width: 12, Length: 64, Yaw: math.Pi / 2}}
	car := Vehicle{X: 2.5, Z: -29, Speed: 6}
	for i := 0; i < 30; i++ {
		car = StepOnRoad(car, Input{Throttle: 1}, nil, roads, .05)
	}
	if car.Z >= -35 || !OnRoad(car, roads) {
		t.Fatalf("connected road seam blocked: %+v", car)
	}
	if !OnRoad(Vehicle{Yaw: math.Pi / 4}, roads) {
		t.Fatal("the shared asphalt of a junction must remain usable")
	}
}

func TestRoadConstraintNeverAcceptsAnUnloadedOrMissingRoad(t *testing.T) {
	car := Vehicle{Speed: 4}
	next := StepOnRoad(car, Input{Throttle: 1}, nil, nil, .05)
	if next.X != car.X || next.Z != car.Z || next.Speed != 0 {
		t.Fatalf("movement without a road: %+v", next)
	}
}
