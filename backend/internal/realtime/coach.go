package realtime

import (
	"context"
	"driving-school/backend/internal/ai"
	"driving-school/backend/internal/storage"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/coder/websocket"
)

func (g *game) interactWithCoach(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var request struct {
		ObjectID string `json:"objectId"`
	}
	if json.Unmarshal(message.Payload, &request) != nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Выберите знак-помощник")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn || p.training == nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "NOT_IN_WORLD", "Сначала войдите в мир")
	}
	l := g.locations[p.training.LocationID]
	if request.ObjectID != l.Helper {
		return hub.replyError(ctx, conn, session, message.RequestID, "STALE_TASK", "Выберите помощника текущей ситуации")
	}
	if p.car.Speed != 0 {
		return hub.replyError(ctx, conn, session, message.RequestID, "VEHICLE_MOVING", "Остановитесь перед разговором")
	}
	payload, _ := json.Marshal(map[string]any{"objectId": l.Helper, "npcId": l.Helper, "name": "ИИ Инструктор", "text": l.Prompt, "lessonIds": []string{l.ID}})
	return hub.reply(ctx, conn, session, envelope{Version: 1, Type: "interaction_result", RequestID: message.RequestID, Payload: payload})
}

func (g *game) askCoach(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var question struct {
		NPCID    string `json:"npcId"`
		Text     string `json:"text"`
		TaskID   string `json:"taskId"`
		Revision int    `json:"sceneRevision"`
		Purpose  string `json:"purpose"`
	}
	if json.Unmarshal(message.Payload, &question) != nil || strings.TrimSpace(question.Text) == "" || utf8.RuneCountInString(question.Text) > 1000 || (question.Purpose != "" && question.Purpose != "answer_feedback") {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Введите вопрос длиной до 1000 символов")
	}
	g.mu.Lock()
	p := g.players[userID]
	if p == nil || p.conn != conn || p.training == nil {
		g.mu.Unlock()
		return hub.replyError(ctx, conn, session, message.RequestID, "NOT_IN_WORLD", "Сначала войдите в учебную ситуацию")
	}
	l := g.locations[p.training.LocationID]
	if question.NPCID != l.Helper || question.TaskID != g.taskID(p) || question.Revision != p.training.Revision {
		g.mu.Unlock()
		return hub.replyError(ctx, conn, session, message.RequestID, "STALE_TASK", "Вопрос относится к другой ситуации")
	}
	if p.coachPending != "" {
		same := p.coachPending == message.RequestID
		g.mu.Unlock()
		if same {
			return true
		}
		return hub.replyError(ctx, conn, session, message.RequestID, "AI_BUSY", "Дождитесь ответа помощника")
	}
	feedback := question.Purpose == "answer_feedback"
	if feedback && p.training.LastAnswer == "" {
		g.mu.Unlock()
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Сначала выберите действие")
	}
	lastAnswer := p.training.LastAnswer
	select {
	case g.coachSlots <- struct{}{}:
	default:
		g.mu.Unlock()
		return hub.replyError(ctx, conn, session, message.RequestID, "AI_BUSY", "Помощник занят. Повторите вопрос чуть позже")
	}
	p.coachPending = message.RequestID
	requestCtx, cancel := context.WithCancel(ctx)
	p.coachCancel = cancel
	g.mu.Unlock()
	// No HTTP/LLM work holds the simulation or WebSocket receive loop.
	go func() {
		defer cancel()
		defer func() { <-g.coachSlots }()
		current, found, err := storage.GetCurrentLocation(requestCtx, g.db, userID)
		var text string
		if err == nil && (!found || current.LocationID != l.ID || !current.Description.Valid || !current.CorrectAnswer.Valid) {
			err = fmt.Errorf("current situation context is missing")
		}
		if err == nil {
			text, err = g.coach.Respond(requestCtx, userID, ai.Request{LocationID: current.LocationID, Title: l.Title, Description: current.Description.String, CorrectAnswer: current.CorrectAnswer.String, Answer: lastAnswer, Message: question.Text}, feedback)
		}
		lock := hub.lockForSession(session)
		lock.Lock()
		defer lock.Unlock()
		hub.mu.Lock()
		revoked := hub.revoked[session]
		hub.mu.Unlock()
		g.mu.Lock()
		defer g.mu.Unlock()
		active := g.players[userID]
		owned := active == p && p.coachPending == message.RequestID
		if owned {
			active.coachPending = ""
			active.coachCancel = nil
		}
		if !owned || revoked || ctx.Err() != nil || p.conn != conn || p.training.LocationID != l.ID || p.training.Revision != question.Revision {
			return
		}
		if err != nil {
			fmt.Printf("coach request failed: %v\n", err)
			hub.replyError(ctx, conn, session, message.RequestID, "AI_UNAVAILABLE", "Локальный помощник не ответил. Повторите вопрос; движение и задания доступны.")
			return
		}
		payload, _ := json.Marshal(map[string]any{"npcId": l.Helper, "name": "ИИ Инструктор", "text": text, "topic": l.ID, "exampleId": nil, "suggestedQuestions": []string{}, "taskId": question.TaskID, "sceneRevision": question.Revision, "sources": []any{}, "visualHints": []any{}, "generation": "local_llm"})
		hub.reply(ctx, conn, session, envelope{Version: 1, Type: "npc_reply", RequestID: message.RequestID, Payload: payload})
	}()
	return true
}
