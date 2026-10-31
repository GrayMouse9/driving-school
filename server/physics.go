package server

import "math"

const vehicleRadius = 2.1

type driverInput struct {
	Seq      int64   `json:"seq"`
	Throttle float64 `json:"throttle"`
	Brake    float64 `json:"brake"`
	Steer    float64 `json:"steer"`
}
type vehiclePhysics struct{ X, Z, Yaw, Speed float64 }
type collisionBox struct{ X, Z, Width, Length, Yaw float64 }

func validInput(input driverInput) bool {
	return input.Seq >= 0 && finiteRange(input.Throttle, 0, 1) && finiteRange(input.Brake, 0, 1) && finiteRange(input.Steer, -1, 1)
}

func finiteRange(v, min, max float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= min && v <= max
}

func stepVehicle(car vehiclePhysics, input driverInput, obstacles []collisionBox, dt float64) vehiclePhysics {
	if !validInput(input) || dt <= 0 || dt > 0.05 {
		return car
	}
	speed := math.Max(0, math.Min(12, car.Speed+(4*input.Throttle-8*input.Brake-0.5)*dt))
	yaw := car.Yaw
	if speed > 0.05 {
		yaw += input.Steer * math.Min(speed/4, 1) * 0.8 * dt
	}
	x := car.X - math.Sin(yaw)*speed*dt
	z := car.Z - math.Cos(yaw)*speed*dt
	for _, box := range obstacles {
		if intersectsBox(x, z, vehicleRadius, box) {
			car.Speed = 0
			return car
		}
	}
	return vehiclePhysics{X: x, Z: z, Yaw: yaw, Speed: speed}
}

func intersectsBox(x, z, radius float64, box collisionBox) bool {
	dx, dz := x-box.X, z-box.Z
	c, s := math.Cos(box.Yaw), math.Sin(box.Yaw)
	localX, localZ := dx*c-dz*s, dx*s+dz*c
	nearX := math.Max(-box.Width/2, math.Min(box.Width/2, localX))
	nearZ := math.Max(-box.Length/2, math.Min(box.Length/2, localZ))
	return math.Hypot(localX-nearX, localZ-nearZ) < radius
}
