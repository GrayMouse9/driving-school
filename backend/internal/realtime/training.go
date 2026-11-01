package realtime

import (
	"context"
	"database/sql"
	"driving-school/backend/internal/player"
	"driving-school/backend/internal/progress"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/coder/websocket"
	"math"
	"time"
)

type location struct {
	ID, Role, ChunkID, CheckpointID, Title, Prompt, Correct, Travel, Next, Helper string
	Routes                                                                        []string
}
type trainingState struct {
	Role         string   `json:"role"`
	LocationID   string   `json:"locationId"`
	Phase        string   `json:"phase"`
	Routes       []string `json:"routes"`
	Index        int      `json:"index"`
	Revision     int      `json:"revision"`
	StoppedAt    int64    `json:"stoppedAt"`
	SharedPassed bool     `json:"sharedPassed"`
	LastAnswer   string   `json:"lastAnswer,omitempty"`
}

func (g *game) initTraining() error {
	g.paths = make(map[string][]player.Point)
	g.zones = make(map[string][]player.Point)
	g.sharedAnswers = make(map[string]bool)
	for _, chunk := range g.w.Chunks {
		if chunk.Teaching != nil {
			for _, p := range chunk.Teaching.Paths {
				g.paths[p.ID] = p.Points
			}
			for _, z := range chunk.Teaching.Zones {
				g.zones[z.ID] = z.Outline
			}
		}
	}
	if g.zones["shared-p-ready"] == nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	rows, err := g.db.QueryContext(ctx, `SELECT id,role,chunk_id,checkpoint_id,title,prompt,correct_answer,travel_action,route_ids,coalesce(next_location_id,''),helper_npc_id FROM locations`)
	if err != nil {
		return err
	}
	defer rows.Close()
	g.locations = make(map[string]location)
	for rows.Next() {
		var l location
		var routes []byte
		if err = rows.Scan(&l.ID, &l.Role, &l.ChunkID, &l.CheckpointID, &l.Title, &l.Prompt, &l.Correct, &l.Travel, &routes, &l.Next, &l.Helper); err != nil {
			return err
		}
		if err = json.Unmarshal(routes, &l.Routes); err != nil {
			return err
		}
		if g.zones[l.CheckpointID] == nil {
			return fmt.Errorf("unknown checkpoint %s", l.CheckpointID)
		}
		for _, id := range l.Routes {
			if len(g.paths[id]) < 2 {
				return fmt.Errorf("unknown route %s", id)
			}
		}
		g.locations[l.ID] = l
	}
	if err = rows.Err(); err != nil {
		return err
	}
	if len(g.locations) != 4 {
		return errors.New("four teaching cards are required")
	}
	return nil
}

func (g *game) restoreTraining(p *gamePlayer) error {
	if len(g.locations) == 0 {
		return nil
	}
	var raw []byte
	err := g.db.QueryRow(`SELECT state FROM player_training WHERE user_id=$1`, p.user.ID).Scan(&raw)
	if err == nil {
		var state trainingState
		if err = json.Unmarshal(raw, &state); err != nil {
			return err
		}
		if _, ok := g.locations[state.LocationID]; !ok {
			return errors.New("unknown saved location")
		}
		p.training = &state
		if state.Phase == "driving" {
			p.training.Phase = "awaiting_direction"
		}
		p.car.Speed = 0
	} else if errors.Is(err, sql.ErrNoRows) {
		role := "P"
		if p.slot%2 == 1 {
			role = "K"
		}
		id := "shared-priority-p"
		if role == "K" {
			id = "shared-priority-k"
		}
		p.training = &trainingState{Role: role, LocationID: id, Phase: "approaching", Revision: 1}
		g.resetToCheckpoint(p)
	} else {
		return err
	}
	if !player.OnRoad(p.car, g.roads) {
		p.training.LocationID = "shared-priority-p"
		if p.training.Role == "K" {
			p.training.LocationID = "shared-priority-k"
		}
		p.training.Phase = "approaching"
		p.training.Routes = nil
		p.training.Index = 0
		g.resetToCheckpoint(p)
	}
	if p.training.SharedPassed {
		g.sharedAnswers[p.training.Role] = true
	}
	g.busHidden = g.sharedAnswers["P"] && g.sharedAnswers["K"]
	return g.save(p)
}
func (g *game) resetToCheckpoint(p *gamePlayer) {
	l := g.locations[p.training.LocationID]
	zone := g.zones[l.CheckpointID]
	x, z := 0.0, 0.0
	for _, v := range zone {
		x += v.X
		z += v.Z
	}
	p.car = player.Vehicle{X: x / float64(len(zone)), Z: z / float64(len(zone))}
	if p.training.Role == "K" {
		p.car.Yaw = math.Pi
	}
	p.y = 0
}
func (g *game) task(p *gamePlayer) map[string]any {
	if p.training == nil || p.training.Phase != "question" {
		return nil
	}
	s := p.training
	l := g.locations[s.LocationID]
	return map[string]any{"lessonId": l.ID, "taskId": g.taskID(p), "kind": "choice", "title": l.Title, "prompt": l.Prompt, "scenarioId": l.ID, "episodeId": nil, "sceneRevision": s.Revision, "role": s.Role, "sourceLabel": "", "helperNpcId": l.Helper, "options": []map[string]string{{"id": "left", "text": "A / ← — налево"}, {"id": "forward", "text": "W / ↑ — прямо"}, {"id": "right", "text": "D / → — направо"}, {"id": "stop", "text": "S / ↓ — остановиться / уступить"}}}
}
func (g *game) taskID(p *gamePlayer) string {
	return fmt.Sprintf("%s:%s:%d", p.user.ID, p.training.LocationID, p.training.Revision)
}
func (g *game) trainingPayload(p *gamePlayer) map[string]any {
	s := p.training
	if s == nil {
		return nil
	}
	l := g.locations[s.LocationID]
	actions := []string{}
	if s.Phase == "awaiting_direction" {
		actions = []string{l.Travel}
	}
	text := "Подъезжаем к ситуации"
	switch s.Phase {
	case "question":
		text = "Что нужно сделать в этой ситуации? Выберите A, W, D или S."
	case "awaiting_direction":
		text = "Машина стоит. Выберите следующее направление."
	case "driving":
		text = "Машина едет по дороге автоматически"
		if l.ID == "shared-priority-k" && !g.primaryClear() {
			text = "Уступаем Даше П: ждём, пока машина на главной дороге проедет. Затем поворот начнётся автоматически."
		}
	case "completed":
		text = "Два задания вашей роли завершены"
	}
	return map[string]any{"helperNpcId": l.Helper, "taskId": g.taskID(p), "phase": s.Phase, "role": s.Role, "locationId": l.ID, "sceneRevision": s.Revision, "allowedActions": actions, "status": text}
}
func (g *game) trainingEvent(p *gamePlayer, kind string, payload any) {
	b, err := json.Marshal(payload)
	if err == nil {
		g.enqueue(p, envelope{Version: 1, Type: kind, Payload: b})
	}
}
func (g *game) emitTraining(p *gamePlayer) {
	if p.training != nil {
		payload := g.trainingPayload(p)
		p.trainingStatus = payload["status"].(string)
		g.trainingEvent(p, "trip_state", payload)
	}
}
func (g *game) route(ids []string) []player.Point {
	var result []player.Point
	for _, id := range ids {
		for _, v := range g.paths[id] {
			if len(result) > 0 && result[len(result)-1].X == v.X && result[len(result)-1].Z == v.Z {
				continue
			}
			result = append(result, v)
		}
	}
	return result
}
func (g *game) primaryClear() bool {
	for _, other := range g.players {
		if other.training != nil && other.training.Role == "P" {
			return other.training.SharedPassed && (other.training.LocationID != "shared-priority-p" || other.car.X < 24)
		}
	}
	// An absent primary vehicle has no priority to yield to. Waiting here
	// would permanently block a learner playing alone as role K.
	return true
}
func (g *game) stepTraining(p *gamePlayer, obstacles []player.CollisionBox, now time.Time) {
	s := p.training
	if s == nil {
		return
	}
	p.input = player.Input{}
	if p.conn == nil || p.persistFailed || p.worldBlocked || !p.confirmed[g.chunkAt(p.car.X, p.car.Z)] {
		p.car.Speed = 0
		return
	}
	l := g.locations[s.LocationID]
	if s.Phase == "approaching" && player.InZone(p.car.X, p.car.Z, g.zones[l.CheckpointID]) {
		p.car.Speed = 0
		s.Phase = "question"
		s.StoppedAt = now.UnixMilli()
		if err := g.save(p); err != nil {
			p.persistFailed = true
			return
		}
		g.trainingEvent(p, "task_started", g.task(p))
		g.emitTraining(p)
		return
	}
	if s.Phase != "driving" {
		p.car.Speed = 0
		return
	}
	if p.trainingStatus != g.trainingPayload(p)["status"].(string) {
		g.emitTraining(p)
	}
	if l.ID == "shared-priority-k" && !g.primaryClear() {
		p.car.Speed = 0
		return
	}
	if l.ID == "green-turn-pedestrians-p" && p.car.X < -28 && p.car.Z <= 22.2 && !g.walkFinished {
		p.car.Speed = 0
		if g.walkStarted.IsZero() {
			g.walkStarted = now
		}
		if now.Sub(g.walkStarted) < 4*time.Second {
			return
		}
		g.walkFinished = true
	}
	route := g.route(s.Routes)
	next, index := player.FollowRoute(p.car, route, s.Index, obstacles, g.roads, .05)
	if !p.confirmed[g.chunkAt(next.X, next.Z)] {
		p.car.Speed = 0
		return
	}
	p.car = next
	s.Index = index
	if index >= len(route) {
		p.car.Speed = 0
		if l.Next == "" {
			s.Phase = "completed"
		} else {
			if p.coachPending != "" {
				payload, _ := json.Marshal(map[string]any{"code": "STALE_TASK", "message": "Началась новая ситуация. Задайте вопрос помощнику по новой карточке.", "retryable": false})
				g.enqueue(p, envelope{Version: 1, Type: "server_error", RequestID: p.coachPending, Payload: payload})
				if p.coachCancel != nil {
					p.coachCancel()
					p.coachCancel = nil
				}
				p.coachPending = ""
			}
			s.LocationID = l.Next
			s.Phase = "approaching"
			s.Revision++
			s.Routes = nil
			s.Index = 0
			s.LastAnswer = ""
		}
		if err := g.save(p); err != nil {
			p.persistFailed = true
		}
		g.emitTraining(p)
	}
}

func (g *game) answer(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var a struct {
		TaskID   string `json:"taskId"`
		AnswerID string `json:"answerId"`
		Revision int    `json:"sceneRevision"`
	}
	if json.Unmarshal(message.Payload, &a) != nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверный ответ")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn || p.training == nil || p.training.Phase != "question" || a.TaskID != g.taskID(p) || a.Revision != p.training.Revision {
		return hub.replyError(ctx, conn, session, message.RequestID, "STALE_TASK", "Карточка устарела")
	}
	if p.worldBlocked || p.persistFailed || !p.confirmed[g.chunkAt(p.car.X, p.car.Z)] {
		return hub.replyError(ctx, conn, session, message.RequestID, "WORLD_NOT_READY", "Дождитесь загрузки локации")
	}
	valid := a.AnswerID == "left" || a.AnswerID == "right" || a.AnswerID == "forward" || a.AnswerID == "stop"
	if !valid {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Выберите A, W, D или S")
	}
	l := g.locations[p.training.LocationID]
	var correctAnswer string
	if err := g.db.QueryRowContext(ctx, `SELECT correct_answer FROM location WHERE player_id=$1 AND location_id=$2`, userID, l.ID).Scan(&correctAnswer); err != nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "SERVICE_UNAVAILABLE", "Не удалось проверить ответ")
	}
	correct := a.AnswerID == correctAnswer
	candidate := *p.training
	candidate.LastAnswer = a.AnswerID
	status := "active"
	explanation := "Этот выбор не подходит. Машина остаётся на месте. Попробуйте ещё раз."
	var mistake any = "answer"
	if correct {
		status = "completed"
		mistake = nil
		if a.AnswerID == "stop" {
			candidate.Phase = "awaiting_direction"
			explanation = "Остановка принята. Машина останется стоять до следующего нажатия направления."
		} else {
			if a.AnswerID != l.Travel {
				return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_LOCATION", "Для этого ответа не настроен безопасный маршрут")
			}
			candidate.Phase = "driving"
			candidate.Routes = l.Routes
			candidate.Index = player.RouteIndex(p.car, g.route(l.Routes))
			explanation = "Верно. Выполняем манёвр автоматически."
		}
		if l.ID == "shared-priority-p" || l.ID == "shared-priority-k" {
			candidate.SharedPassed = true
		}
	}
	tx, err := g.db.BeginTx(ctx, nil)
	if err != nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "SERVICE_UNAVAILABLE", "Не удалось сохранить результат")
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, `INSERT INTO lesson_progress(user_id,lesson_id,status,attempts) VALUES($1,$2,$3,1) ON CONFLICT(user_id,lesson_id) DO UPDATE SET status=EXCLUDED.status,attempts=lesson_progress.attempts+1`, userID, l.ID, status)
	if err == nil && !correct {
		_, err = tx.ExecContext(ctx, `INSERT INTO mistakes(user_id,topic,kind,count) VALUES($1,$2,'answer',1) ON CONFLICT(user_id,topic,kind) DO UPDATE SET count=mistakes.count+1`, userID, l.ID)
	}
	if err == nil && correct {
		_, err = tx.ExecContext(ctx, `INSERT INTO learned_topics(user_id,topic) VALUES($1,$2) ON CONFLICT DO NOTHING`, userID, l.ID)
	}
	raw, _ := json.Marshal(candidate)
	if err == nil {
		_, err = tx.ExecContext(ctx, saveTrainingSQL, userID, p.car.X, p.y, p.car.Z, p.car.Yaw, raw)
	}
	if err == nil {
		err = tx.Commit()
	}
	if err != nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "SERVICE_UNAVAILABLE", "Не удалось сохранить результат")
	}
	p.training = &candidate
	if p.coachCancel != nil {
		p.coachCancel()
		p.coachCancel = nil
		p.coachPending = ""
	}
	p.car.Speed = 0
	if candidate.SharedPassed {
		g.sharedAnswers[candidate.Role] = true
	}
	g.busHidden = g.sharedAnswers["P"] && g.sharedAnswers["K"]
	response, _ := json.Marshal(map[string]any{"lessonId": l.ID, "taskId": a.TaskID, "correct": correct, "explanation": explanation, "stage": "choice", "mistakeKind": mistake, "nextTaskId": nil})
	ok := hub.reply(ctx, conn, session, envelope{Version: 1, Type: "answer_result", RequestID: message.RequestID, Payload: response})
	if pr, e := progress.Read(ctx, g.db, userID); e == nil {
		g.trainingEvent(p, "progress_updated", map[string]any{"progress": pr})
	}
	g.emitTraining(p)
	return ok
}
func (g *game) maneuver(ctx context.Context, userID string, conn *websocket.Conn, message envelope, hub *socketHub, session [32]byte) bool {
	var a struct {
		LocationID string `json:"locationId"`
		Action     string `json:"action"`
		Revision   int    `json:"sceneRevision"`
	}
	if json.Unmarshal(message.Payload, &a) != nil {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MESSAGE", "Неверный манёвр")
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	p := g.players[userID]
	if p == nil || p.conn != conn || p.training == nil || p.training.Phase != "awaiting_direction" || p.training.LocationID != a.LocationID || p.training.Revision != a.Revision {
		return hub.replyError(ctx, conn, session, message.RequestID, "STALE_TASK", "Манёвр уже выбран или карточка устарела")
	}
	l := g.locations[a.LocationID]
	if a.Action != l.Travel {
		return hub.replyError(ctx, conn, session, message.RequestID, "INVALID_MANEUVER", "Выберите разрешённое направление")
	}
	if p.worldBlocked || !p.confirmed[g.chunkAt(p.car.X, p.car.Z)] || p.persistFailed {
		return hub.replyError(ctx, conn, session, message.RequestID, "WORLD_NOT_READY", "Локация ещё загружается")
	}
	if l.ID == "stop-no-line-k" && time.Now().UnixMilli()-p.training.StoppedAt < 500 {
		return hub.replyError(ctx, conn, session, message.RequestID, "STOP_REQUIRED", "Дождитесь полной остановки")
	}
	old := *p.training
	p.training.Phase = "driving"
	p.training.Routes = l.Routes
	p.training.Index = player.RouteIndex(p.car, g.route(l.Routes))
	if err := g.save(p); err != nil {
		p.training = &old
		return hub.replyError(ctx, conn, session, message.RequestID, "SERVICE_UNAVAILABLE", "Не удалось сохранить манёвр")
	}
	data, _ := json.Marshal(map[string]any{"action": "maneuver_choose", "ok": true})
	ok := hub.reply(ctx, conn, session, envelope{Version: 1, Type: "action_result", RequestID: message.RequestID, Payload: data})
	g.emitTraining(p)
	return ok
}

const saveTrainingSQL = `WITH saved AS (
 INSERT INTO player_state(user_id,x,y,z,yaw) VALUES($1,$2,$3,$4,$5)
 ON CONFLICT(user_id) DO UPDATE SET x=EXCLUDED.x,y=EXCLUDED.y,z=EXCLUDED.z,yaw=EXCLUDED.yaw RETURNING user_id
), current_location AS (
 INSERT INTO location(player_id,location_id,description,correct_answer)
 SELECT $1,id,description,correct_answer FROM locations WHERE id=($6::jsonb->>'locationId')
 ON CONFLICT(player_id) DO UPDATE SET location_id=EXCLUDED.location_id,
 description=CASE WHEN location.location_id=EXCLUDED.location_id THEN coalesce(location.description,EXCLUDED.description) ELSE EXCLUDED.description END,
 correct_answer=CASE WHEN location.location_id=EXCLUDED.location_id THEN coalesce(location.correct_answer,EXCLUDED.correct_answer) ELSE EXCLUDED.correct_answer END
) INSERT INTO player_training(user_id,state) SELECT user_id,$6::jsonb FROM saved ON CONFLICT(user_id) DO UPDATE SET state=EXCLUDED.state`
