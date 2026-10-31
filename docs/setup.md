# Запуск и локальная сеть

Сборка, быстрый запуск и карта исходников — в [README проекта](../README.md).
Здесь только дополнительные настройки окружения и сети.

## Серверное окружение

Нужны PostgreSQL, Go 1.22+ и Node.js для сборки клиента. Backend запускается из
`backend/`, собранный frontend раздаётся им же. Другим ноутбукам нужен браузер.

| Переменная | Назначение |
|---|---|
| `DATABASE_URL` | Обязательная строка подключения к существующей PostgreSQL; задать локально |
| `WORLD_FILE` | Обязательный путь к `../server-data/world/training-world.json` |
| `CLIENT_DIR` | Папка frontend; по умолчанию `../frontend/dist` |
| `LISTEN_ADDR` | Для проекта `:18080`; значение Go по умолчанию `:8080` |

Перед запуском создать БД и роль, если это чистая установка. Backend создаёт
отсутствующие таблицы, но не саму БД. Пароли и токены в документацию не записывать.
В текущей локальной установке PostgreSQL работает в контейнере `backend-db-1`,
БД — `driving_school`, роль — `localtest`, volume — `backend_postgres_data`.

```bash
docker start backend-db-1
docker exec backend-db-1 pg_isready -U localtest -d driving_school
```

Если Docker обслуживает Docker Desktop, сначала запустить его. Существующий
volume содержит данные игроков; удаление контейнеров/volume для запуска не нужно.

При запрете записи в стандартные Go-кеши можно задать:

```bash
export GOCACHE=/tmp/hahaton-go-cache
export GOMODCACHE=/tmp/hahaton-go-mod
export GOPATH=/tmp/hahaton-go-path
```

Для работы без интернета заранее подготовить npm/Go-зависимости, собрать
`frontend/dist` и Go-бинарник. Копирования исходников на чистый ноутбук недостаточно.

## Подключение браузеров

Серверный браузер: `http://localhost:18080`.
Остальные: `http://<Wi-Fi IPv4 сервера>:18080`, одна локальная сеть и разные аккаунты.
Новый игровой вход под тем же аккаунтом заменяет прежнее соединение.

Сначала проверить `/api/v1/health`: ожидается `{"status":"ok"}`.
Если localhost работает, а клиенты не подключаются, проверить адрес, брандмауэр,
проброс WSL и отсутствие изоляции клиентов в Wi-Fi сети.

## Windows + WSL

В обычном PowerShell узнать адреса:

```powershell
ipconfig
wsl -d Ubuntu-24.04 -- hostname -I
```

Клиентам нужен IPv4 Windows из раздела Wi-Fi. Для проброса нужен адрес WSL.
Они могут изменяться после смены сети или перезапуска WSL.
Если проброс ещё не настроен, в PowerShell **от администратора**:

```powershell
$wslAddress = (wsl -d Ubuntu-24.04 -- hostname -I).Trim().Split(' ')[0]
netsh interface portproxy add v4tov4 listenaddress=0.0.0.0 listenport=18080 connectaddress=$wslAddress connectport=18080
netsh interface portproxy show all
```

Для отсутствующего правила брандмауэра, в том же окне:

```powershell
New-NetFirewallRule -DisplayName "DrivingSchool18080" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 18080 -RemoteAddress LocalSubnet
```

При работающем подключении заново настраивать проброс и правило не нужно.

## Автономная проверка и неполадки

- Для проверки без Wi-Fi сначала открыть игру на сервере через localhost,
  затем выключить Wi-Fi, обновить страницу, войти и проехать с загрузкой участков.
  Другие ноутбуки при этом закономерно теряют связь. ИИ проверять отдельно после интеграции.
- `database unavailable` — проверить PostgreSQL и `DATABASE_URL`.
- `address already in use` — проверить health: возможно, backend уже запущен.
- После новой сборки обновить браузер через Ctrl+F5; после изменения карты перезапустить backend.

