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
