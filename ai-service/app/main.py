from fastapi import FastAPI, Header, HTTPException

from app.graph import run_interaction

from app.schemas import (
    ActionRequest,
    QuestionRequest,
    CoachResponse
)


app = FastAPI(
    title="ROADWISE AI Instructor",
    description="Локальный LangGraph-инструктор",
    version="0.2.0"
)


# ==========================================
# ПОЛУЧЕНИЕ ИДЕНТИФИКАТОРА ИГРОКА
# ==========================================

def get_player_id(
    x_player_id: str | None
) -> str:

    if not x_player_id:

        raise HTTPException(
            status_code=401,
            detail="Требуется авторизация."
        )

    return x_player_id


# ==========================================
# ПРОВЕРКА РАБОТЫ СЕРВЕРА
# ==========================================

@app.get("/health")
def health():

    return {
        "status": "ok",
        "service": "roadwise-ai"
    }


# ==========================================
# ПРОВЕРКА ДЕЙСТВИЯ
# ==========================================

@app.post(
    "/api/coach/action",
    response_model=CoachResponse
)
def coach_action(
    request: ActionRequest,
    x_player_id: str | None = Header(default=None)
):

    player_id = get_player_id(x_player_id)

    try:

        result = run_interaction(

            player_id=player_id,

            interaction_type="action",

            location_id=request.location_id,

            title=request.title,

            description=request.description,

            correct_answer=request.correct_answer,

            answer=request.answer
        )

        return result

    except ValueError as exc:

        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )


# ==========================================
# ДОПОЛНИТЕЛЬНЫЙ ВОПРОС
# ==========================================

@app.post(
    "/api/coach/question",
    response_model=CoachResponse
)
def coach_question(
    request: QuestionRequest,
    x_player_id: str | None = Header(default=None)
):

    player_id = get_player_id(x_player_id)

    try:

        result = run_interaction(

            player_id=player_id,

            interaction_type="question",

            location_id=request.location_id,

            user_message=request.message,
            title=request.title,
            description=request.description,
            correct_answer=request.correct_answer,
            answer=request.answer
        )

        return result

    except ValueError as exc:

        raise HTTPException(
            status_code=400,
            detail=str(exc)
        )

    except Exception as exc:

        raise HTTPException(
            status_code=500,
            detail=str(exc)
        )
