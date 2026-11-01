package realtime

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
)

const defaultSystemPrompt = `
Ты — дружелюбный виртуальный инструктор по вождению.

Твоя задача — помогать игроку изучать правила дорожного движения.

Общие правила:

- Всегда отвечай на русском языке.
- Объясняй понятно, спокойно и доброжелательно.
- Не унижай игрока и не используй агрессивный тон.
- Не придумывай обстоятельства дорожной ситуации.
- Не выдумывай номера пунктов ПДД.
- Учитывай предыдущие сообщения в истории этого игрока.
- Не оспаривай результаты программной проверки действий.
`

// repo: читает общий файл промпта или исходный промпт при отсутствии файла.
func readSystemPrompt() (string, error) {
	path := os.Getenv("AI_SYSTEM_PROMPT_FILE")
	if path == "" {
		return "", errors.New("AI_SYSTEM_PROMPT_FILE не настроен")
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		info, statErr := os.Stat(filepath.Dir(path))
		if statErr != nil {
			return "", statErr
		}
		if !info.IsDir() {
			return "", errors.New("каталог промпта недоступен")
		}
		return defaultSystemPrompt, nil
	}
	if err != nil {
		return "", err
	}
	return string(data), nil
}

// repo: атомарно записывает промпт в общий файл для AI-сервиса.
func writeSystemPrompt(prompt string) error {
	if strings.TrimSpace(prompt) == "" || len(prompt) > 65536 {
		return errors.New("Промпт должен содержать от 1 до 65536 байт")
	}
	path := os.Getenv("AI_SYSTEM_PROMPT_FILE")
	if path == "" {
		return errors.New("AI_SYSTEM_PROMPT_FILE не настроен")
	}
	f, err := os.CreateTemp(filepath.Dir(path), ".prompt-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(prompt); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}
