package server

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
)

type worldMeta struct {
	Version          string `json:"version"`
	TotalWorldBytes  int    `json:"totalWorldBytes"`
	CacheBudgetBytes int    `json:"cacheBudgetBytes"`
	Accounting       string `json:"accounting"`
}
type chunkRef struct {
	ID        string `json:"id"`
	Version   int    `json:"version"`
	DataBytes int    `json:"dataBytes"`
	Resources []any  `json:"resources"`
}
type worldInterest struct {
	Revision         int        `json:"revision"`
	WorldVersion     string     `json:"worldVersion"`
	Chunks           []chunkRef `json:"chunks"`
	RemoveChunkIDs   []string   `json:"removeChunkIds"`
	CacheBudgetBytes int        `json:"cacheBudgetBytes"`
}
type worldChunk struct {
	ref        chunkRef
	x, z, size float64
	data       []byte
	obstacles  []collisionBox
}
type spawnPoint struct {
	X   float64 `json:"x"`
	Y   float64 `json:"y"`
	Z   float64 `json:"z"`
	Yaw float64 `json:"yaw"`
}
type world struct {
	meta   worldMeta
	chunks map[string]worldChunk
	spawns []spawnPoint
}

func loadWorld(data []byte) (*world, error) {
	var input struct {
		Version     string            `json:"version"`
		Chunks      []json.RawMessage `json:"chunks"`
		SpawnPoints []spawnPoint      `json:"spawnPoints"`
	}
	if err := json.Unmarshal(data, &input); err != nil {
		return nil, err
	}
	if input.Version == "" || len(input.Chunks) == 0 {
		return nil, errors.New("world version and chunks are required")
	}
	w := &world{chunks: make(map[string]worldChunk)}
	refs := make([]chunkRef, 0, len(input.Chunks))
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
			Objects   []struct {
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
			Roads  []json.RawMessage `json:"roads"`
			Agents []json.RawMessage `json:"agents"`
		}
		if err := json.Unmarshal(raw, &c); err != nil {
			return nil, err
		}
		if c.ID == "" || c.Version < 1 || c.Size <= 0 || c.Objects == nil || c.Roads == nil || c.Agents == nil || c.Resources == nil || len(c.Resources) != 0 {
			return nil, errors.New("invalid chunk or unsupported resource")
		}
		if _, exists := w.chunks[c.ID]; exists {
			return nil, fmt.Errorf("duplicate chunk %q", c.ID)
		}
		for _, existing := range w.chunks {
			if c.Origin.X < existing.x+existing.size && c.Origin.X+c.Size > existing.x && c.Origin.Z < existing.z+existing.size && c.Origin.Z+c.Size > existing.z {
				return nil, errors.New("overlapping chunks")
			}
		}
		ref := chunkRef{ID: c.ID, Version: c.Version, DataBytes: len(raw), Resources: []any{}}
		chunk := worldChunk{ref: ref, x: c.Origin.X, z: c.Origin.Z, size: c.Size, data: append([]byte(nil), raw...)}
		for _, object := range c.Objects {
			if object.Collidable {
				if object.Size.X <= 0 || object.Size.Z <= 0 {
					return nil, errors.New("invalid obstacle dimensions")
				}
				chunk.obstacles = append(chunk.obstacles, collisionBox{X: object.Position.X, Z: object.Position.Z, Width: object.Size.X, Length: object.Size.Z, Yaw: object.Yaw})
			}
		}
		w.chunks[c.ID] = chunk
		refs = append(refs, ref)
		w.meta.TotalWorldBytes += len(raw)
	}
	manifest, err := json.Marshal(struct {
		Version string     `json:"version"`
		Chunks  []chunkRef `json:"chunks"`
	}{input.Version, refs})
	if err != nil {
		return nil, err
	}
	w.meta.TotalWorldBytes += len(manifest)
	w.meta.Version = input.Version
	w.meta.CacheBudgetBytes = w.meta.TotalWorldBytes * 8 / 100
	w.meta.Accounting = "utf8-uncompressed-json-plus-unique-assets"
	for i, spawn := range input.SpawnPoints {
		if _, err := w.interest(spawn.X, spawn.Z, 1, nil); err != nil {
			return nil, fmt.Errorf("invalid spawn: %w", err)
		}
		for _, prior := range input.SpawnPoints[:i] {
			if math.Hypot(spawn.X-prior.X, spawn.Z-prior.Z) < 2*vehicleRadius {
				return nil, errors.New("overlapping spawn points")
			}
		}
		for _, chunk := range w.chunks {
			for _, obstacle := range chunk.obstacles {
				if intersectsBox(spawn.X, spawn.Z, vehicleRadius, obstacle) {
					return nil, errors.New("spawn intersects obstacle")
				}
			}
		}
	}
	w.spawns = input.SpawnPoints
	return w, nil
}

func (w *world) interest(x, z float64, revision int, previous []string) (worldInterest, error) {
	result := worldInterest{Revision: revision, WorldVersion: w.meta.Version, Chunks: []chunkRef{}, RemoveChunkIDs: []string{}, CacheBudgetBytes: w.meta.CacheBudgetBytes}
	var current string
	var candidates []worldChunk
	for id, c := range w.chunks {
		if x >= c.x && x < c.x+c.size && z >= c.z && z < c.z+c.size {
			if current != "" {
				return result, errors.New("overlapping chunks")
			}
			current = id
		}
		candidates = append(candidates, c)
	}
	if current == "" {
		return result, errors.New("position outside world")
	}
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].ref.ID == current && candidates[j].ref.ID != current {
			return true
		}
		if candidates[j].ref.ID == current && candidates[i].ref.ID != current {
			return false
		}
		a, b := candidates[i], candidates[j]
		da := math.Hypot(x-(a.x+a.size/2), z-(a.z+a.size/2))
		db := math.Hypot(x-(b.x+b.size/2), z-(b.z+b.size/2))
		if da == db {
			return a.ref.ID < b.ref.ID
		}
		return da < db
	})
	metaBytes, err := json.Marshal(w.meta)
	if err != nil {
		return result, err
	}
	used := 0
	for _, c := range candidates {
		result.Chunks = append(result.Chunks, c.ref)
		result.RemoveChunkIDs = removedChunks(previous, result.Chunks)
		encoded, err := json.Marshal(result)
		if err != nil {
			return result, err
		}
		if len(metaBytes)+len(encoded)+used+c.ref.DataBytes > w.meta.CacheBudgetBytes {
			result.Chunks = result.Chunks[:len(result.Chunks)-1]
			result.RemoveChunkIDs = removedChunks(previous, result.Chunks)
			break
		}
		used += c.ref.DataBytes
	}
	for len(result.Chunks) > 0 {
		result.RemoveChunkIDs = removedChunks(previous, result.Chunks)
		encoded, err := json.Marshal(result)
		if err != nil {
			return result, err
		}
		if len(metaBytes)+len(encoded)+used <= w.meta.CacheBudgetBytes {
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

func removedChunks(previous []string, current []chunkRef) []string {
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
