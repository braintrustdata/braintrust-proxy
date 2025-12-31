from openai.types.chat.chat_completion_chunk import ChoiceDelta as BaseChoiceDelta
from pydantic import BaseModel


class ReasoningModel(BaseModel):
    id: str | None = None
    content: str | None = None


class ChoiceDelta(BaseChoiceDelta):
    reasoning: ReasoningModel | None = None
