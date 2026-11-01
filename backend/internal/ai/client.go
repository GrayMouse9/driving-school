package ai

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// Request contains only context resolved by the authenticated game server.
type Request struct {
	LocationID    string `json:"location_id"`
	Title         string `json:"title"`
	Description   string `json:"description"`
	CorrectAnswer string `json:"correct_answer,omitempty"`
	Answer        string `json:"answer,omitempty"`
	Message       string `json:"message,omitempty"`
}

type Client struct {
	baseURL string
	http    *http.Client
}

func NewClient(baseURL string) *Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	// The coach is a local service; never route its data through a machine's
	// optional internet proxy (including when the game runs offline).
	transport.Proxy = nil
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), http: &http.Client{Timeout: 120 * time.Second, Transport: transport}}
}

func (c *Client) Respond(ctx context.Context, playerID string, payload Request, feedback bool) (string, error) {
	if c == nil || c.baseURL == "" {
		return "", errors.New("coach is not configured")
	}
	endpoint := "/api/coach/question"
	if feedback {
		endpoint = "/api/coach/action"
	} else {
		payload.CorrectAnswer = ""
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return "", err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+endpoint, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Player-ID", playerID)
	response, err := c.http.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("coach HTTP %d", response.StatusCode)
	}
	var result struct {
		Answer string `json:"answer"`
	}
	if err = json.NewDecoder(io.LimitReader(response.Body, 64*1024)).Decode(&result); err != nil {
		return "", err
	}
	if strings.TrimSpace(result.Answer) == "" {
		return "", errors.New("coach returned an empty answer")
	}
	return result.Answer, nil
}
