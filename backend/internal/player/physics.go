package player

import "math"

const Radius = 2.1

type Input struct {
	Seq      int64   `json:"seq"`
	Throttle float64 `json:"throttle"`
	Brake    float64 `json:"brake"`
	Steer    float64 `json:"steer"`
}
type Vehicle struct{ X, Z, Yaw, Speed float64 }
type CollisionBox struct{ X, Z, Width, Length, Yaw float64 }

func ValidInput(input Input) bool {
	return input.Seq >= 0 && FiniteRange(input.Throttle, 0, 1) && FiniteRange(input.Brake, 0, 1) && FiniteRange(input.Steer, -1, 1)
}

func FiniteRange(v, min, max float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= min && v <= max
}

func Step(car Vehicle, input Input, obstacles []CollisionBox, dt float64) Vehicle {
	if !ValidInput(input) || dt <= 0 || dt > 0.05 {
		return car
	}
	// Arcade controls: S brakes first, then reverses; releasing keys stops.
	speed := car.Speed
	if input.Throttle > 0 && input.Brake == 0 {
		if speed < 0 {
			speed = math.Min(0, speed+8*dt)
		} else {
			speed = math.Min(12, speed+4*input.Throttle*dt)
		}
	} else if input.Brake > 0 {
		if speed > 0 {
			speed = math.Max(0, speed-8*input.Brake*dt)
		} else {
			speed = math.Max(-3, speed-4*input.Brake*dt)
		}
	} else if speed > 0 {
		speed = math.Max(0, speed-8*dt)
	} else {
		speed = math.Min(0, speed+8*dt)
	}
	yaw := car.Yaw
	if math.Abs(speed) > 0.05 {
		yaw += input.Steer * math.Copysign(math.Min(math.Abs(speed)/4, 1), speed) * 0.8 * dt
	}
	x := car.X - math.Sin(yaw)*speed*dt
	z := car.Z - math.Cos(yaw)*speed*dt
	for _, box := range obstacles {
		if IntersectsBox(x, z, Radius, box) && distanceToBox(x, z, box) <= distanceToBox(car.X, car.Z, box) {
			car.Speed = 0
			return car
		}
	}
	return Vehicle{X: x, Z: z, Yaw: yaw, Speed: speed}
}

func IntersectsBox(x, z, radius float64, box CollisionBox) bool {
	return distanceToBox(x, z, box) < radius
}

func distanceToBox(x, z float64, box CollisionBox) float64 {
	dx, dz := x-box.X, z-box.Z
	c, s := math.Cos(box.Yaw), math.Sin(box.Yaw)
	localX, localZ := dx*c-dz*s, dx*s+dz*c
	nearX := math.Max(-box.Width/2, math.Min(box.Width/2, localX))
	nearZ := math.Max(-box.Length/2, math.Min(box.Length/2, localZ))
	return math.Hypot(localX-nearX, localZ-nearZ)
}
