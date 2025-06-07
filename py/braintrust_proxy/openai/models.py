from typing import Optional

from openai.types.chat.chat_completion_chunk import ChoiceDelta as BaseChoiceDelta
from pydantic import BaseModel


class ReasoningModel(BaseModel):
    id: Optional[str] = None
    content: Optional[str] = None


class ChoiceDelta(BaseChoiceDelta):
    reasoning: Optional[ReasoningModel] = None
