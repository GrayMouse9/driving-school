# Автошкола — Говорящий город

Браузерный многопользовательский тренажёр ПДД на TypeScript, three.js и Go.
Один компьютер запускает backend и PostgreSQL и раздаёт готовый frontend.
Остальным участникам нужен только браузер в общей LAN/Wi-Fi сети.

Рабочая папка: `/home/dasha/files/sem5/hahaton`.
В Windows: `\\wsl.localhost\Ubuntu-24.04\home\dasha\files\sem5\hahaton`.

## Структура

```text
frontend/src/
  app/                 запуск приложения и связывание компонентов
  auth/                вход, регистрация и выход в интерфейсе
  game/rendering/      сцена, камера и геометрия three.js
  game/player/         управление и типы ввода
  game/entities/       типы игроков, автомобилей и знаков
  game/world/          загрузка, бюджет и отдельная preview-сцена
  game/interactions/   выбор знаков, диалоги, состояние учебных карточек
  network/             HTTP, WebSocket и согласование загрузки
  ui/                  разметка, стили, чат, HUD и миникарта
backend/
  cmd/server/          запуск HTTP-сервера
  internal/auth/       авторизация, пароли и сессии
  internal/lobby/      модель общей игровой сессии
  internal/realtime/   WebSocket, общий игровой цикл и сетевые обработчики
  internal/player/     физика движения и столкновения
  internal/world/      загрузка карты и выбор участков
  internal/progress/   чтение прогресса обучения
  internal/storage/    SQL-инициализация и сохранение позиций
  internal/httpx/      общий формат HTTP-ответов и ошибок
  internal/scenario/   зарезервировано; учебный сервер пока не реализован
  internal/ai/         зарезервировано; AI gateway пока не реализован
  migrations/          встроенный SQL начальной схемы
ai-service/            пустые app/, agents/, retrieval/ для кода Даши К
server-data/
  world/               активная карта, генератор и проверки
  education/           место для исполняемого учебного контента, пока пусто
  models/              место для файлов моделей, пока пусто
docs/                  единая документация и визуальные референсы
```

## Запуск собранного приложения

Нужны Node.js для сборки frontend, Go 1.22+ для сборки backend и PostgreSQL.
Зависимости должны быть подготовлены заранее для полностью автономного запуска.

Из корня проекта:

```bash
npm --prefix frontend run build
```

Затем в терминале Ubuntu:

```bash
cd /home/dasha/files/sem5/hahaton/backend
# DATABASE_URL должна содержать строку подключения к вашей PostgreSQL.
export LISTEN_ADDR=:18080
export WORLD_FILE=../server-data/world/training-world.json
export CLIENT_DIR=../frontend/dist
go run ./cmd/server
```

Без `DATABASE_URL` backend не запустится. При запуске создаются отсутствующие
таблицы. Существующие данные сохраняются, переноса записей БД не требуется.
Для production можно заранее собрать `go build -o /tmp/traffic-world-server ./cmd/server`
и запускать полученный файл с теми же переменными окружения.

Серверный браузер: **http://localhost:18080**.
Другие ноутбуки: **http://<LAN-IP сервера>:18080**.
Проверка backend и БД: **http://localhost:18080/api/v1/health**.

Go раздаёт frontend и API/WS с одного адреса. Отдельный Vite для этого режима не нужен.
В WSL может требоваться проброс порта Windows; подробности в
[инструкции запуска](docs/запуск.md).
Старые временные команды, ссылающиеся на `client/`, `server/` и `content/`,
после реорганизации нужно заменить командами выше.

## Разработка frontend

При работающем backend, во втором терминале из корня:

```bash
npm --prefix frontend run dev
```

Открыть http://localhost:5173. API и WebSocket проксируются на localhost:18080;
переменная `BACKEND_ORIGIN` позволяет выбрать другой сервер разработки.
При отсутствии зависимостей сначала выполнить `npm --prefix frontend ci`;
это может потребовать интернет.

«Проверка 3D без сервера» — отдельная локальная сцена. Она не использует
настоящую авторизацию, PostgreSQL, мультиплеер или ИИ.

W — вперёд, S — тормоз/назад, A/D — поворот. Отпускание клавиш останавливает
машину. После чата щёлкнуть по дороге. E/щелчок открывает окно знака, Esc закрывает.
Выхода из машины и обзора мышью нет.

## Что менять руками

| Что | Где |
|---|---|
| Активная серверная карта | `server-data/world/generate-training-world.mjs` |
| Генерация и проверка карты | `node server-data/world/generate-training-world.mjs`, затем `node server-data/world/check-world.mjs --go` |
| Локальная preview-сцена | `frontend/src/game/world/preview.ts` |
| Геометрия и камера | `frontend/src/game/rendering/` |
| Разметка и стили | `frontend/src/ui/layout.ts`, `frontend/src/ui/style.css` |
| Форма авторизации | `frontend/src/auth/` |
| HTTP и WS клиента | `frontend/src/network/` |
| Загрузка и лимит данных | `frontend/src/game/world/` |
| Движение на сервере | `backend/internal/player/physics.go` |
| Серверный мир и сетевые события | `backend/internal/world/`, `backend/internal/realtime/` |

Координаты в метрах: X — поперёк, Z — вдоль земли, Y — вверх.
`yaw=0` направлен к −Z, `PI/2` к −X, `−PI/2` к +X.
После изменения серверной карты нужна регенерация JSON и перезапуск backend.
Правки preview не меняют активную серверную карту.

## Проверки

```bash
npm --prefix frontend test
npm --prefix frontend run build
node server-data/world/check-world.mjs --go
```

Из `backend/`: `go test ./...`. Для интеграционных тестов PostgreSQL нужна
отдельная база в `DRIVING_SCHOOL_TEST_DATABASE_URL`. Без неё эти проверки пропускаются.
`frontend/tests/browser-smoke.ts` использует HTTP/WS-фикстуры;
`frontend/tests/backend-smoke.ts` проверяет настоящий сервер по `BACKEND_URL`.
Второй тест занимает две машины, поэтому запускать его на отдельном тестовом сервере.

## Состояние функций

В коде есть авторизация, общий мир, серверная физика, чат, сохранение позиций,
подгрузка и выгрузка участков. Активна одна общая сцена перекрёстка, автобус неподвижен.
Клиентские карточки и диалоги подготовлены; серверной проверки заданий,
подключённого ИИ и памяти агентов пока нет. Пустые каталоги не означают готовые функции.

Диагностика считает байты JSON и метаданных с рабочим бюджетом 8%.
Полный учёт генерируемых графических ресурсов не выполнен; это не измерение GPU-памяти.

## Документация

- [Оглавление](docs/README.md).
- [Архитектура](docs/архитектура.md).
- [Требования](docs/требования.md).
- [Фактический API](docs/api-contracts.md).
- [Учебные ситуации](<docs/superpowers/specs/учебные ситуации.md>).

Спецификации и планы дальнейших изменений хранятся в `docs/superpowers/`.
Коммиты, push и pull requests выполняет пользователь.
