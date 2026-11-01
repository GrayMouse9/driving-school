package player

import "math"

type Point struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
	Z float64 `json:"z"`
}

func InZone(x, z float64, outline []Point) bool {
	inside := false
	for i, j := 0, len(outline)-1; i < len(outline); j, i = i, i+1 {
		a, b := outline[i], outline[j]
		if (a.Z > z) != (b.Z > z) && x < (b.X-a.X)*(z-a.Z)/(b.Z-a.Z)+a.X {
			inside = !inside
		}
	}
	return inside
}

func FollowRoute(car Vehicle, points []Point, index int, obstacles, roads []CollisionBox, dt float64) (Vehicle, int) {
	if index < 1 || index >= len(points) || dt <= 0 {
		car.Speed = 0
		return car, index
	}
	target := points[index]
	dx, dz := target.X-car.X, target.Z-car.Z
	distance := math.Hypot(dx, dz)
	if distance < .001 {
		index++
		car.Speed = 0
		return car, index
	}
	travel := math.Min(distance, 4*dt)
	next := Vehicle{X: car.X + dx/distance*travel, Z: car.Z + dz/distance*travel, Yaw: math.Atan2(-dx, -dz), Speed: 4}
	if !OnRoad(next, roads) {
		car.Speed = 0
		return car, index
	}
	for _, box := range obstacles {
		if IntersectsBox(next.X, next.Z, Radius, box) && distanceToBox(next.X, next.Z, box) <= distanceToBox(car.X, car.Z, box) {
			car.Speed = 0
			return car, index
		}
	}
	if travel >= distance-.00001 {
		index++
		if index >= len(points) {
			next.Speed = 0
		}
	}
	return next, index
}

func RouteIndex(car Vehicle, points []Point) int {
	best, index := math.Inf(1), 1
	for i := 1; i < len(points); i++ {
		a, b := points[i-1], points[i]
		dx, dz := b.X-a.X, b.Z-a.Z
		length := dx*dx + dz*dz
		if length == 0 {
			continue
		}
		t := math.Max(0, math.Min(1, ((car.X-a.X)*dx+(car.Z-a.Z)*dz)/length))
		distance := math.Hypot(car.X-a.X-t*dx, car.Z-a.Z-t*dz)
		if distance < best {
			best = distance
			index = i
			if t > .9999 {
				index = i + 1
			}
		}
	}
	return index
}
