package world

import (
	"os"
	"testing"
)

func TestOnlyCurrentLocationAndImmediateBoundaryAreLoaded(t *testing.T) {
	data, err := os.ReadFile("../../../server-data/world/training-world.json")
	if err != nil {
		t.Fatal(err)
	}
	w, err := Load(data)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		x, z float64
		want []string
	}{
		{34.5, 42, []string{"c_0_0"}},
		{6, 29.5, []string{"c_0_0", "c_-1_0"}},
		{-1, 29.5, []string{"c_-1_0", "c_0_0"}},
		{96, 34.5, []string{"c_1_0"}},
	} {
		area, err := w.Interest(tc.x, tc.z, 1, nil)
		if err != nil {
			t.Fatal(err)
		}
		if len(area.Chunks) != len(tc.want) {
			t.Fatalf("at %g,%g got %v chunks, want only %v", tc.x, tc.z, len(area.Chunks), tc.want)
		}
		for i, id := range tc.want {
			if area.Chunks[i].ID != id {
				t.Fatalf("at %g,%g chunk %d=%s want %s", tc.x, tc.z, i, area.Chunks[i].ID, id)
			}
		}
	}
}
