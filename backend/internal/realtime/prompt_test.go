package realtime

import (
	"os"
	"path/filepath"
	"testing"
)

func TestPromptFilePersistsAndRejectsEmpty(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prompt.txt")
	t.Setenv("AI_SYSTEM_PROMPT_FILE", path)
	initial, err := readSystemPrompt()
	if err != nil || initial != defaultSystemPrompt {
		t.Fatalf("default: %q %v", initial, err)
	}
	if err := writeSystemPrompt(" \n"); err == nil {
		t.Fatal("empty prompt accepted")
	}
	if err := writeSystemPrompt("Новая инструкция"); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(path)
	if err != nil || string(content) != "Новая инструкция" {
		t.Fatalf("saved prompt: %q %v", content, err)
	}
	actual, err := readSystemPrompt()
	if err != nil || actual != "Новая инструкция" {
		t.Fatalf("read prompt: %q %v", actual, err)
	}
}
