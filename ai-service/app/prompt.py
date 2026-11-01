import os
from pathlib import Path

BASE_SYSTEM_PROMPT = """
Ты — дружелюбный виртуальный инструктор по вождению.

Твоя задача — помогать игроку изучать правила дорожного движения.

Общие правила:

- Всегда отвечай на русском языке.
- Объясняй понятно, спокойно и доброжелательно.
- Не унижай игрока и не используй агрессивный тон.
- Не придумывай обстоятельства дорожной ситуации.
- Не выдумывай номера пунктов ПДД.
- Учитывай предыдущие сообщения в истории этого игрока.
- Не оспаривай результаты программной проверки действий.
"""


# service: читает актуальную инструкцию перед каждым обращением к модели.
def current_system_prompt() -> str:
    path = os.getenv("AI_SYSTEM_PROMPT_FILE")
    if not path:
        return BASE_SYSTEM_PROMPT
    try:
        return Path(path).read_text(encoding="utf-8")
    except FileNotFoundError:
        return BASE_SYSTEM_PROMPT
