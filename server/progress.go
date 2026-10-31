package server

import (
	"database/sql"
	"net/http"
)

type lessonProgress struct {
	LessonID string `json:"lessonId"`
	Status   string `json:"status"`
	Attempts int    `json:"attempts"`
}
type mistake struct {
	Topic string `json:"topic"`
	Kind  string `json:"kind"`
	Count int    `json:"count"`
}
type progress struct {
	Lessons       []lessonProgress `json:"lessons"`
	LearnedTopics []string         `json:"learnedTopics"`
	Mistakes      []mistake        `json:"mistakes"`
}

func readProgress(r *http.Request, db *sql.DB, userID string) (progress, error) {
	p := progress{Lessons: []lessonProgress{}, LearnedTopics: []string{}, Mistakes: []mistake{}}
	rows, err := db.QueryContext(r.Context(), `SELECT lesson_id,status,attempts FROM lesson_progress WHERE user_id=$1 ORDER BY lesson_id`, userID)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var item lessonProgress
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
	rows, err = db.QueryContext(r.Context(), `SELECT topic FROM learned_topics WHERE user_id=$1 ORDER BY topic`, userID)
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
	rows, err = db.QueryContext(r.Context(), `SELECT topic,kind,count FROM mistakes WHERE user_id=$1 ORDER BY topic,kind`, userID)
	if err != nil {
		return p, err
	}
	for rows.Next() {
		var item mistake
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
