CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY,
    username text NOT NULL,
    password_hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_idx ON users (lower(username));

CREATE TABLE IF NOT EXISTS sessions (
    token_hash bytea PRIMARY KEY,
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS player_state (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    x double precision NOT NULL,
    y double precision NOT NULL,
    z double precision NOT NULL,
    yaw double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS lesson_progress (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    lesson_id text NOT NULL,
    status text NOT NULL CHECK (status IN ('available', 'active', 'completed')),
    attempts integer NOT NULL CHECK (attempts >= 0),
    PRIMARY KEY (user_id, lesson_id)
);
CREATE TABLE IF NOT EXISTS learned_topics (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic text NOT NULL,
    PRIMARY KEY (user_id, topic)
);
CREATE TABLE IF NOT EXISTS mistakes (
    user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    topic text NOT NULL,
    kind text NOT NULL CHECK (kind IN ('answer', 'driving')),
    count integer NOT NULL CHECK (count >= 0),
    PRIMARY KEY (user_id, topic, kind)
);
CREATE TABLE IF NOT EXISTS location (
    player_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    location_id text NOT NULL,
    description text,
    correct_answer text
);
