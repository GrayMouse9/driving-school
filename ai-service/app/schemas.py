from typing import Literal
from pydantic import BaseModel, Field


Action = Literal["forward", "left", "right", "stop"]


class ActionRequest(BaseModel):
    location_id: int

    title: str
    description: str

    correct_answer: Action
    answer: Action


class QuestionRequest(BaseModel):
    location_id: int | None = None

    message: str = Field(
        min_length=1,
        max_length=2000
    )


class CoachResponse(BaseModel):
    thread_id: str
    answer: str
    evaluation: dict | None = None
