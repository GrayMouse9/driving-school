# Фактический HTTP/WS-контракт

Контракт существующего Go backend после структурного переноса. Маршруты и JSON
не изменялись. Целевые учебные команды перечислены отдельно и не считаются готовыми.
Источник реализации: `backend/internal/auth/`, `backend/internal/realtime/`.

## Подключение и авторизация

Frontend, HTTP и WS обслуживаются одним сервером. HTTP-запросы относительные,
WebSocket подключается к текущему `location.host` по `/ws`. Для показа используется
порт 18080; Go по умолчанию использует 8080. Конкретный LAN IP не фиксируется в коде.

Регистрация и вход принимают `{username,password}`. Имя после trim — 1–40 символов,
пароль — 8–15 символов. Регистрация не выполняет автоматический вход.
Вход устанавливает HttpOnly cookie `session`; сервер хранит хеш токена в PostgreSQL.
Без действующей сессии WS не обновляется до WebSocket-соединения.

## HTTP

| Метод | Путь | Результат |
|---|---|---|
| GET | `/api/v1/health` | 200 `{status:"ok"}` при доступной БД, иначе 503 |
| POST | `/api/v1/auth/register` | 201 `{user}` |
| POST | `/api/v1/auth/login` | 200 `{user}` и cookie |
| POST | `/api/v1/auth/logout` | Тело `{}`; 204, отзыв сессии и закрытие её WS |
| GET | `/api/v1/profile` | `{user,progress}` |
| GET | `/api/v1/progress` | `{progress}`; только чтение существующих записей |
| GET | `/api/v1/game/session` | `{id:"main",playersOnline,maxPlayers}` |
| GET | `/api/v1/world/manifest` | `{version,totalWorldBytes,cacheBudgetBytes,accounting}`; после входа в мир |
| GET | `/api/v1/world/chunks/{chunkId}` | JSON разрешённого участка, `Cache-Control: no-store` |
| GET | `/api/v1/world/assets/{assetId}` | Сейчас 404: внешние ресурсы участков не поддержаны |

Ошибки HTTP: `{error:{code,message}}`. Пользователь: `{id,username}`.
Прогресс: `{lessons,learnedTopics,mistakes}`; серверной оценки учебных действий пока нет.

## WebSocket

Конверт: `{v:1,type,requestId?,payload}`. Кроме `player_input` и `ping`, клиентские
операции требуют `requestId`; ответы могут коррелироваться с ним.

| Клиент → сервер | Сервер → клиент | Назначение |
|---|---|---|
| `join_world {}` | `world_joined`, затем `world_interest` | Войти и получить машину |
| `world_loaded {revision,chunkIds}` | `world_load_status {revision,ready}` | Подтвердить всю текущую область |
| `world_load_failed {revision,code,chunkId,message}` | Статус/ошибка, при необходимости новый интерес | Сообщить об ошибке загрузки |
| `player_input {seq,throttle,brake,steer}` | `players_snapshot` | Управление и общие позиции |
| `chat_send {text}` | `action_result`, `chat_message` | Общий чат |
| `leave_world {}` | `world_left` | Выйти из мира |
| `ping {clientTime}` | `pong {clientTime,serverTime}` | Проверить связь |

`world_joined`: `{selfId,tickRate,player,vehicles,progress,episode:null,activeTask:null}`.
Игрок: `{id,username,position,yaw,vehicleId}`; поле `mode` в этом сервере не передаётся.
Автомобиль: `{id,driverId,variant,controller,position,yaw,speed}`.
Позиция: `{x,y,z}`. Время сервера — Unix milliseconds.

`player_input` содержит ровно четыре поля. `seq` — неотрицательная целая
последовательность клиента; `throttle`/`brake` от 0 до 1, `steer` от −1 до 1.
До 20 команд в секунду. S тормозит, затем включает движение назад.
Итоговое движение и столкновения рассчитываются сервером с частотой 20 Гц.
Снимки отправляются примерно 10 раз в секунду:
`{tick,serverTime,ackInputSeq,players,vehicles,pedestrians:[],signals:[]}`.

Машина назначается по свободному слоту. Новый вход того же аккаунта заменяет
старое игровое WS-соединение; это не второй независимый игрок.

## Загрузка мира

`world_interest`:
`{revision,worldVersion,chunks:[{id,version,dataBytes,resources:[]}],removeChunkIds,cacheBudgetBytes}`.

Клиент получает метаданные, выгружает ненужное, загружает разрешённые участки,
отправляет `world_loaded` и ждёт `world_load_status` с соответствующими
`requestId` и `revision`. Только после этого отправляет управление.

`dataBytes` — несжатые UTF-8 байты JSON. Учитываются метаданные и резерв загрузок;
рабочий бюджет — 8%. Внешние `resources` сейчас пусты. Это не измерение RAM/GPU
и не полная оценка объёма генерируемых моделей и текстур.

## Пока не реализовано на сервере

`episode_join`, `episode_ready`, `episode_leave`, `lesson_start`, `answer_submit`,
`interact`, `npc_message` подготовлены в клиентских типах/обработчиках, но текущий
backend отвечает на них ошибкой. LLM, RAG, учебная оценка и память агентов
не появились в результате переноса каталогов.

Развёрнутые клиентские типы — `frontend/src/network/protocol.ts`.
Их разделы будущих функций не расширяют фактический серверный контракт.
