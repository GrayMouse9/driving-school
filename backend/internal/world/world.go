package world

import (
	"driving-school/backend/internal/player"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
)

type Meta struct {
	Version          string `json:"version"`
	TotalWorldBytes  int    `json:"totalWorldBytes"`
	CacheBudgetBytes int    `json:"cacheBudgetBytes"`
	Accounting       string `json:"accounting"`
}

const PrefetchDistance = 8.0

type ChunkRef struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	DataBytes int    `json:"dataBytes"`
	Resources []any  `json:"resources"`
}
type Interest struct {
	Revision         int        `json:"revision"`
	WorldVersion     string     `json:"worldVersion"`
	Chunks           []ChunkRef `json:"chunks"`
	RemoveChunkIDs   []string   `json:"removeChunkIds"`
	CacheBudgetBytes int        `json:"cacheBudgetBytes"`
}
type Chunk struct {
	Ref        ChunkRef
	X, Z, Size float64
	Data       []byte
	Obstacles  []player.CollisionBox
	Roads      []player.CollisionBox
	Teaching   *Teaching
	Observers  []Observer
}

type Observer struct {
	ID        string
	X, Z, Yaw float64
}

type Teaching struct {
	Paths []struct {
		ID     string         `json:"id"`
		Points []player.Point `json:"points"`
	} `json:"paths"`
	Zones []struct {
		ID      string         `json:"id"`
		Kind    string         `json:"kind"`
		Outline []player.Point `json:"outline"`
	} `json:"zones"`
}
type SpawnPoint struct {
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"`
}
type World struct {
	Meta   Meta
	Chunks map[string]Chunk
	Spawns []SpawnPoint
}

func Load(data []byte) (*World, error) {
	var input struct {
		Version     string            `json:"version"`
		Chunks      []json.RawMessage `json:"chunks"`
		SpawnPoints []SpawnPoint      `json:"spawnPoints"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}
	if input.Version == "" || len(input.Chunks) == 0 {
		return nil, errors.New("world version and chunks are required")
	}
	w := &World{Chunks: make(map[string]Chunk)}
	refs := make([]ChunkRef, 0, len(input.Chunks))
	for _, raw := range input.Chunks {
		var c struct {
			ID      string `json:"id"`
			Version int    `json:"version"`
			Origin  struct {
				X float64 `json:"x"`
				Z float64 `json:"z"`
			} `json:"origin"`
			Size      float64           `json:"size"`
			Resources []json.RawMessage `json:"resources"`
			Teaching  *Teaching         `json:"teaching"`
			Objects   []struct {
				ID       string `json:"id"`
				Kind     string `json:"kind"`
				Position struct {
					X float64 `json:"x"`
					Z float64 `json:"z"`
				} `json:"position"`
				Size struct {
					X float64 `json:"x"`
					Z float64 `json:"z"`
				} `json:"size"`
				Yaw        float64 `json:"yaw"`
				Collidable bool    `json:"collidable"`
			} `json:"objects"`
			Roads []struct {
				Position struct {
					X float64 `json:"x"`
					Z float64 `json:"z"`
				} `json:"position"`
				Yaw    float64 `json:"yaw"`
				Width  float64 `json:"width"`
				Length float64 `json:"length"`
			} `json:"roads"`
			Agents []json.RawMessage `json:"agents"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, err
		}
		if c.ID == "" || c.Version < 1 || c.Size <= 0 || c.Objects == nil || c.Roads == nil || c.Agents == nil || c.Resources == nil || len(c.Resources) != 0 {
			return nil, errors.New("invalid chunk or unsupported resource")
		}
		if _, exists := w.Chunks[c.ID]; exists {
			return nil, fmt.Errorf("duplicate chunk %q", c.ID)
		}
		for _, existing := range w.Chunks {
			if c.Origin.X < existing.X+existing.Size && c.Origin.X+c.Size > existing.X && c.Origin.Z < existing.Z+existing.Size && c.Origin.Z+c.Size > existing.Z {
				return nil, errors.New("overlapping chunks")
			}
		}
		ref := ChunkRef{ID: c.ID, Version: c.Version, DataBytes: len(raw), Resources: []any{}}
		chunk := Chunk{Ref: ref, X: c.Origin.X, Z: c.Origin.Z, Size: c.Size, Data: append([]byte(nil), raw...), Teaching: c.Teaching}
		for _, road := range c.Roads {
			if !player.FiniteRange(road.Position.X, -1e9, 1e9) || !player.FiniteRange(road.Position.Z, -1e9, 1e9) || !player.FiniteRange(road.Yaw, -1e9, 1e9) || !player.FiniteRange(road.Width, 0.01, 1e9) || !player.FiniteRange(road.Length, 0.01, 1e9) {
				return nil, errors.New("invalid road geometry")
			}
			chunk.Roads = append(chunk.Roads, player.CollisionBox{X: road.Position.X, Z: road.Position.Z, Yaw: road.Yaw, Width: road.Width, Length: road.Length})
		}
		for _, object := range c.Objects {
			if object.Kind == "observer" {
				if object.ID == "" || !player.FiniteRange(object.Position.X, c.Origin.X, c.Origin.X+c.Size) || !player.FiniteRange(object.Position.Z, c.Origin.Z, c.Origin.Z+c.Size) || !player.FiniteRange(object.Yaw, -1e9, 1e9) {
					return nil, errors.New("invalid observer")
				}
				chunk.Observers = append(chunk.Observers, Observer{ID: object.ID, X: object.Position.X, Z: object.Position.Z, Yaw: object.Yaw})
			}
			if object.Collidable {
				if object.Size.X <= 0 || object.Size.Z <= 0 {
					return nil, errors.New("invalid obstacle dimensions")
				}
				chunk.Obstacles = append(chunk.Obstacles, player.CollisionBox{X: object.Position.X, Z: object.Position.Z, Width: object.Size.X, Length: object.Size.Z, Yaw: object.Yaw, ObjectID: object.ID})
			}
		}
		w.Chunks[c.ID] = chunk
		refs = append(refs, ref)
		w.Meta.TotalWorldBytes += len(raw)
	}
	manifest, err := json.Marshal(struct {
		Version string     `json:"version"`
		Chunks  []ChunkRef `json:"chunks"`
	}{input.Version, refs})
	if err != nil {
		return nil, err
	}
	w.Meta.TotalWorldBytes += len(manifest)
	w.Meta.Version = input.Version
	w.Meta.CacheBudgetBytes = w.Meta.TotalWorldBytes * 8 / 100
	w.Meta.Accounting = "utf8-uncompressed-json-plus-unique-assets"
	for i, spawn := range input.SpawnPoints {
		if _, err := w.Interest(spawn.X, spawn.Z, 1, nil); err != nil {
			return nil, fmt.Errorf("invalid spawn: %w", err)
		}
		for _, prior := range input.SpawnPoints[:i] {
			if math.Hypot(spawn.X-prior.X, spawn.Z-prior.Z) < 2*player.Radius {
				return nil, errors.New("overlapping spawn points")
			}
		}
		for _, chunk := range w.Chunks {
			for _, obstacle := range chunk.Obstacles {
				if player.IntersectsBox(spawn.X, spawn.Z, player.Radius, obstacle) {
					return nil, errors.New("spawn intersects obstacle")
				}
			}
		}
	}
	w.Spawns = input.SpawnPoints
	return w, nil
}

func (w *World) Interest(x, z float64, revision int, previous []string) (Interest, error) {
	result := Interest{Revision: revision, WorldVersion: w.Meta.Version, Chunks: []ChunkRef{}, RemoveChunkIDs: []string{}, CacheBudgetBytes: w.Meta.CacheBudgetBytes}
	var current string
	var candidates []Chunk
	for id, c := range w.Chunks {
		if x >= c.X && x < c.X+c.Size && z >= c.Z && z < c.Z+c.Size {
			if current != "" {
				return result, errors.New("overlapping chunks")
			}
			current = id
		}
		dx := math.Max(math.Max(c.X-x, 0), x-c.X-c.Size)
		dz := math.Max(math.Max(c.Z-z, 0), z-c.Z-c.Size)
		if math.Hypot(dx, dz) <= PrefetchDistance {
			candidates = append(candidates, c)
		}
	}
	if current == "" {
		return result, errors.New("position outside world")
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].Ref.ID == current && candidates[j].Ref.ID != current {
			return true
		}
		if candidates[j].Ref.ID == current && candidates[i].Ref.ID != current {
			return false
		}
		a, b := candidates[i], candidates[j]
		da := math.Hypot(x-(a.X+a.Size/2), z-(a.Z+a.Size/2))
		db := math.Hypot(x-(b.X+b.Size/2), z-(b.Z+b.Size/2))
		if da == db {
			return a.Ref.ID < b.Ref.ID
		}
		return da < db
	})
	metaBytes, err := json.Marshal(w.Meta)
	if err != nil {
		return result, err
	}
	used := 0
	for _, c := range candidates {
		result.Chunks = append(result.Chunks, c.Ref)
		result.RemoveChunkIDs = RemovedChunks(previous, result.Chunks)
		encoded, err := json.Marshal(result)
		if err != nil {
			return result, err
		}
		if len(metaBytes)+len(encoded)+used+c.Ref.DataBytes > w.Meta.CacheBudgetBytes {
			result.Chunks = result.Chunks[:len(result.Chunks)-1]
			result.RemoveChunkIDs = RemovedChunks(previous, result.Chunks)
			break
		}
		used += c.Ref.DataBytes
	}
	for len(result.Chunks) > 0 {
		result.RemoveChunkIDs = RemovedChunks(previous, result.Chunks)
		encoded, err := json.Marshal(result)
		if err != nil {
			return result, err
		}
		if len(metaBytes)+len(encoded)+used <= w.Meta.CacheBudgetBytes {
			break
		}
		used -= result.Chunks[len(result.Chunks)-1].DataBytes
		result.Chunks = result.Chunks[:len(result.Chunks)-1]
	}
	if len(result.Chunks) == 0 {
		return result, errors.New("WORLD_BUDGET_EXCEEDED")
	}
	return result, nil
}

func RemovedChunks(previous []string, current []ChunkRef) []string {
	kept := make(map[string]bool, len(current))
	for _, c := range current {
		kept[c.ID] = true
	}
	removed := []string{}
	for _, id := range previous {
		if !kept[id] {
			removed = append(removed, id)
		}
	}
	return removed
}
