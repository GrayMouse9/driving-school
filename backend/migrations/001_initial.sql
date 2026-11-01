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

CREATE TABLE IF NOT EXISTS locations (
    id text PRIMARY KEY,
    role text NOT NULL CHECK (role IN ('P','K')),
    chunk_id text NOT NULL,
    checkpoint_id text NOT NULL,
    title text NOT NULL,
    prompt text NOT NULL,
    description text NOT NULL DEFAULT '',
    correct_answer text NOT NULL CHECK (correct_answer IN ('left','forward','right','stop')),
    travel_action text NOT NULL CHECK (travel_action IN ('left','forward','right')),
    route_ids jsonb NOT NULL,
    next_location_id text,
    helper_npc_id text NOT NULL
);
ALTER TABLE locations ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
INSERT INTO locations(id,role,chunk_id,checkpoint_id,title,prompt,description,correct_answer,travel_action,route_ids,next_location_id,helper_npc_id) VALUES
 ('shared-priority-p','P','c_0_0','shared-p-ready','Вы на главной дороге','Поверните налево.','Задание инструктора: повернуть налево. Автомобиль ученика подъехал с юга; установлен знак «Главная дорога» с направлением главной дороги налево. Автобус подъехал слева по главной дороге и намерен ехать прямо. Другой автомобиль подъехал со встречной второстепенной дороги и намерен повернуть налево.','left','left','["shared-p-left","shared-p-to-crosswalk"]','green-turn-pedestrians-p','shared-priority-sign'),
 ('shared-priority-k','K','c_0_0','shared-k-ready','Вы на второстепенной дороге','Поверните налево.','Задание инструктора: повернуть налево. Автомобиль ученика подъехал с севера; перед ним знак «Уступите дорогу». На главной дороге находятся встречный автомобиль и автобус слева.','stop','left','["shared-k-left","shared-k-to-stop","stop-k-approach"]','stop-no-line-k','shared-yield-sign'),
 ('green-turn-pedestrians-p','P','c_-1_0','pedestrians-card','Поворот направо и пешеходы','Поверните направо.','Задание инструктора: повернуть направо. На светофоре горит зелёный сигнал. На дороге, в которую направлен поворот, расположен пешеходный переход; его пересекают пешеходы.','stop','right','["pedestrians-p-right"]',NULL,'pedestrians-crosswalk-sign'),
 ('stop-no-line-k','K','c_1_0','stop-card','STOP без стоп-линии','Продолжите движение прямо.','Задание инструктора: продолжить движение прямо через перекрёсток. Перед пересекаемой дорогой установлен знак STOP. Стоп-линия отсутствует.','stop','forward','["stop-k-continue"]',NULL,'stop-no-line-sign')
ON CONFLICT (id) DO NOTHING;

-- Upgrade the original demo wording once, preserving manually edited tasks.
UPDATE locations AS current SET prompt=content.prompt,description=content.description,correct_answer=content.correct_answer
FROM (VALUES
 ('shared-priority-p','Главная дорога поворачивает налево. Вы на главной и имеете приоритет. Выберите манёвр.','Поверните налево.','Задание инструктора: повернуть налево. Автомобиль ученика подъехал с юга; установлен знак «Главная дорога» с направлением главной дороги налево. Автобус подъехал слева по главной дороге и намерен ехать прямо. Другой автомобиль подъехал со встречной второстепенной дороги и намерен повернуть налево.','left'),
 ('shared-priority-k','Перед левым поворотом пропустите транспорт на главной. Что нужно сделать?','Поверните налево.','Задание инструктора: повернуть налево. Автомобиль ученика подъехал с севера; перед ним знак «Уступите дорогу». На главной дороге находятся встречный автомобиль и автобус слева.','stop'),
 ('green-turn-pedestrians-p','На зелёный нужно повернуть направо. Машина пропустит пешеходов перед переходом. Выберите направление поворота.','Поверните направо.','Задание инструктора: повернуть направо. На светофоре горит зелёный сигнал. На дороге, в которую направлен поворот, расположен пешеходный переход; его пересекают пешеходы.','stop'),
 ('stop-no-line-k','Перед пересекаемой дорогой установлен STOP. Подтвердите обязательную остановку, затем можно продолжить прямо.','Продолжите движение прямо.','Задание инструктора: продолжить движение прямо через перекрёсток. Перед пересекаемой дорогой установлен знак STOP. Стоп-линия отсутствует.','stop')
) AS content(id,old_prompt,prompt,description,correct_answer)
WHERE current.id=content.id AND current.prompt=content.old_prompt;

UPDATE location AS current SET description=content.description,correct_answer=content.correct_answer
FROM (VALUES
 ('shared-priority-p','Главная дорога поворачивает налево. Вы на главной и имеете приоритет. Выберите манёвр.','Поверните налево.','Задание инструктора: повернуть налево. Автомобиль ученика подъехал с юга; установлен знак «Главная дорога» с направлением главной дороги налево. Автобус подъехал слева по главной дороге и намерен ехать прямо. Другой автомобиль подъехал со встречной второстепенной дороги и намерен повернуть налево.','left'),
 ('shared-priority-k','Перед левым поворотом пропустите транспорт на главной. Что нужно сделать?','Поверните налево.','Задание инструктора: повернуть налево. Автомобиль ученика подъехал с севера; перед ним знак «Уступите дорогу». На главной дороге находятся встречный автомобиль и автобус слева.','stop'),
 ('green-turn-pedestrians-p','На зелёный нужно повернуть направо. Машина пропустит пешеходов перед переходом. Выберите направление поворота.','Поверните направо.','Задание инструктора: повернуть направо. На светофоре горит зелёный сигнал. На дороге, в которую направлен поворот, расположен пешеходный переход; его пересекают пешеходы.','stop'),
 ('stop-no-line-k','Перед пересекаемой дорогой установлен STOP. Подтвердите обязательную остановку, затем можно продолжить прямо.','Продолжите движение прямо.','Задание инструктора: продолжить движение прямо через перекрёсток. Перед пересекаемой дорогой установлен знак STOP. Стоп-линия отсутствует.','stop')
) AS content(id,old_prompt,prompt,description,correct_answer)
WHERE current.location_id=content.id AND current.description=content.old_prompt;


CREATE TABLE IF NOT EXISTS player_training (
    user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state jsonb NOT NULL
);
