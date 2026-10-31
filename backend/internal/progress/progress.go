package progress

import (
	"context"
	"database/sql"
)

type Lesson struct {
	LessonID string `json:"lessonId"`
	Status   string `json:"status"`
	Attempts int    `json:"attempts"`
}
type Mistake struct {
	Topic string `json:"topic"`
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}
type State struct {
	Lessons       []Lesson  `json:"lessons"`
	LearnedTopics []string  `json:"learnedTopics"`
	Mistakes      []Mistake `json:"mistakes"`
}

func Read(ctx context.Context, db *sql.DB, userID string) (State, error) {
	p := State{Lessons: []Lesson{}, LearnedTopics: []string{}, Mistakes: []Mistake{}}
	rows, err := db.QueryContext(ctx, `SELECT lesson_id,status,attempts FROM lesson_progress WHERE user_id=$1 ORDER BY lesson_id`, userID)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var item Lesson
		if err = rows.Scan(&item.LessonID, &item.Status, &item.Attempts); err != nil {
			rows.Close()
			return p, err
		}
		p.Lessons = append(p.Lessons, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return p, err
	}
	rows, err = db.QueryContext(ctx, `SELECT topic FROM learned_topics WHERE user_id=$1 ORDER BY topic`, userID)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var item string
		if err = rows.Scan(&item); err != nil {
			rows.Close()
			return p, err
		}
		p.LearnedTopics = append(p.LearnedTopics, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return p, err
	}
	rows, err = db.QueryContext(ctx, `SELECT topic,kind,count FROM mistakes WHERE user_id=$1 ORDER BY topic,kind`, userID)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var item Mistake
		if err = rows.Scan(&item.Topic, &item.Kind, &item.Count); err != nil {
			rows.Close()
			return p, err
		}
		p.Mistakes = append(p.Mistakes, item)
	}
	err = rows.Err()
	rows.Close()
	return p, err
}
