from typing import Annotated, Literal, TypedDict

from langchain_core.messages import (
    AIMessage,
    AnyMessage,
    HumanMessage,
    SystemMessage
)

from langchain_ollama import ChatOllama

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

from app.config import OLLAMA_BASE_URL, OLLAMA_MODEL
from app.schemas import Action


InteractionType = Literal["action", "question"]

class GameState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]

    # Пользователь и текущая ситуация
    player_id: str
    location_id: int | None

    # Тип взаимодействия
    interaction_type: InteractionType

    # Информация о дорожной ситуации
    title: str | None
    description: str | None

    # Правильный ответ из БД
    correct_answer: Action | None

    # Ответ игрока
    answer: Action | None

    # Результат проверки
    evaluation: dict | None

llm = ChatOllama(
    model=OLLAMA_MODEL,
    base_url=OLLAMA_BASE_URL,
    temperature=0.2
)


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


# ==========================================
# 4. ЕДИНСТВЕННЫЙ УЗЕЛ ГРАФА
# ==========================================

def coach_node(state: GameState) -> dict:

    interaction_type = state["interaction_type"]

    # --------------------------------------
    # СЦЕНАРИЙ 1. ИГРОК ВЫБРАЛ ДЕЙСТВИЕ
    # --------------------------------------

    if interaction_type == "action":

        answer = state.get("answer")
        correct_answer = state.get("correct_answer")

        title = state.get("title") or "Дорожная ситуация"

        description = (
            state.get("description")
            or "Описание ситуации не передано."
        )

        if answer is None or correct_answer is None:
            raise ValueError(
                "Для проверки действия нужны answer и correct_answer."
            )

        # Сравнение выполняет Python, а не LLM.
        is_correct = answer == correct_answer

        evaluation = {
            "location_id": state.get("location_id"),
            "answer": answer,
            "correct_answer": correct_answer,
            "is_correct": is_correct
        }

        # Правильный ответ
        if is_correct:

            task_prompt = f"""
Игрок правильно выбрал действие.

Название ситуации: {title}

Описание:
{description}

Действие игрока: {answer}

Правильное действие: {correct_answer}

Поздравь игрока с правильным решением.

Кратко объясни, почему это действие подходит
для данной дорожной ситуации.

Не меняй результат проверки:
игрок ответил правильно.
"""

        # Неправильный ответ
        else:

            task_prompt = f"""
Игрок выбрал неправильное действие.

Название ситуации: {title}

Описание:
{description}

Действие игрока: {answer}

Правильное действие: {correct_answer}

Объясни доброжелательно:

1. Что игрок выбрал неправильно.
2. Какое действие было правильным.
3. Почему в описанной дорожной ситуации
   нужно поступить именно так.

Опирайся на переданные описание
и правильный ответ.

Не придумывай дополнительные обстоятельства.
Не оспаривай результат программной проверки.
"""

        system_message = SystemMessage(
            content=BASE_SYSTEM_PROMPT + "\n" + task_prompt
        )

        # Передаём системную инструкцию и историю диалога в LLM.
        response = llm.invoke(
            [system_message, *state["messages"]]
        )

        return {
            "messages": [response],
            "evaluation": evaluation
        }

    # --------------------------------------
    # СЦЕНАРИЙ 2. ДОПОЛНИТЕЛЬНЫЙ ВОПРОС
    # --------------------------------------

    elif interaction_type == "question":

        task_prompt = """
Игрок задаёт дополнительный вопрос инструктору.

Ответь на вопрос, учитывая предыдущую историю переписки.

Если вопрос относится к ранее разобранной ситуации,
используй контекст предыдущих сообщений.

Если данных недостаточно или ты не уверен
в точном правиле, честно обозначь это.
"""

        system_message = SystemMessage(
            content=BASE_SYSTEM_PROMPT + "\n" + task_prompt
        )

        response = llm.invoke(
            [system_message, *state["messages"]]
        )

        return {
            "messages": [response],

            # Убираем результат предыдущей проверки,
            # чтобы не вернуть его при новом вопросе.
            "evaluation": None
        }

    else:

        raise ValueError(
            f"Неизвестный тип взаимодействия: {interaction_type}"
        )


# ==========================================
# 5. СОЗДАНИЕ ГРАФА
# ==========================================

def build_graph():

    builder = StateGraph(GameState)

    # Единственный узел
    builder.add_node("coach_node", coach_node)

    # START -> coach_node -> END
    builder.add_edge(START, "coach_node")
    builder.add_edge("coach_node", END)

    # Память
    memory = MemorySaver()

    return builder.compile(
        checkpointer=memory
    )


graph = build_graph()


# ==========================================
# 6. ЗАПУСК ВЗАИМОДЕЙСТВИЯ
# ==========================================

def run_interaction(
    *,
    player_id: str,
    interaction_type: InteractionType,

    location_id: int | None = None,

    title: str | None = None,
    description: str | None = None,

    correct_answer: Action | None = None,
    answer: Action | None = None,

    user_message: str | None = None
) -> dict:

    # --------------------------------------
    # Формируем сообщение пользователя
    # --------------------------------------

    if interaction_type == "action":

        if answer is None or correct_answer is None:
            raise ValueError(
                "Для action нужны answer и correct_answer."
            )

        human_message = HumanMessage(
            content=f"Моё действие на перекрёстке: {answer}."
        )

    elif interaction_type == "question":

        if not user_message or not user_message.strip():
            raise ValueError("Вопрос не должен быть пустым.")

        human_message = HumanMessage(
            content=user_message.strip()
        )

    else:

        raise ValueError(
            f"Неизвестный тип взаимодействия: {interaction_type}"
        )

    # --------------------------------------
    # THREAD_ID
    # --------------------------------------

    thread_id = f"roadwise:player:{player_id}"

    config = {
        "configurable": {
            "thread_id": thread_id
        }
    }

    # --------------------------------------
    # НАЧАЛЬНОЕ СОСТОЯНИЕ
    # --------------------------------------

    initial_state: GameState = {

        "messages": [human_message],

        "player_id": str(player_id),

        "location_id": location_id,

        "interaction_type": interaction_type,

        "title": title,

        "description": description,

        "correct_answer": correct_answer,

        "answer": answer,

        "evaluation": None
    }

    # --------------------------------------
    # ЗАПУСК ГРАФА
    # --------------------------------------

    result = graph.invoke(
        initial_state,
        config=config
    )

    last_message = result["messages"][-1]

    answer_text = last_message.content

    if isinstance(answer_text, list):

        answer_text = "\n".join(
            block.get("text", "")
            if isinstance(block, dict)
            else str(block)
            for block in answer_text
        )

    return {
        "thread_id": thread_id,
        "answer": str(answer_text),
        "evaluation": result.get("evaluation")
    }
