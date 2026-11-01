package realtime

import "math"

type observer struct {
	ID, ChunkID string
	X, Z, Yaw   float64
	BodyYaw     float64
}

type observerView struct {
	ID  string  `json:"id"`
	Yaw float64 `json:"yaw"`
}

func (g *game) updateObservers(dt float64) {
	for i := range g.observers {
		o := &g.observers[i]
		nearest := 32.0
		target := ""
		targetYaw := o.Yaw
		for id, p := range g.players {
			if p.conn == nil {
				continue
			}
			dx, dz := p.car.X-o.X, p.car.Z-o.Z
			distance := math.Hypot(dx, dz)
			if distance < .001 || distance > nearest || (distance == nearest && target != "" && id > target) {
				continue
			}
			nearest = distance
			target = id
			targetYaw = math.Atan2(-dx, -dz)
		}
		if target == "" {
			continue
		}
		// A person turns their head relative to a fixed torso, not through 360°.
		relative := math.Atan2(math.Sin(targetYaw-o.BodyYaw), math.Cos(targetYaw-o.BodyYaw))
		limit := 75 * math.Pi / 180
		targetYaw = o.BodyYaw + math.Max(-limit, math.Min(limit, relative))
		delta := math.Atan2(math.Sin(targetYaw-o.Yaw), math.Cos(targetYaw-o.Yaw))
		step := math.Max(-2*dt, math.Min(2*dt, delta))
		o.Yaw = math.Atan2(math.Sin(o.Yaw+step), math.Cos(o.Yaw+step))
	}
}

func (g *game) observerViews(allowed map[string]bool) []observerView {
	result := []observerView{}
	for _, o := range g.observers {
		if allowed[o.ChunkID] {
			result = append(result, observerView{ID: o.ID, Yaw: o.Yaw})
		}
	}
	return result
}
