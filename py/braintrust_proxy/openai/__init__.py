from typing import cast

from .models import BaseChoiceDelta, ChoiceDelta
from .types import BaseChatCompletionMessageParam, ChatCompletionMessageParam


def as_openai_chat_message_param(message: ChatCompletionMessageParam) -> BaseChatCompletionMessageParam:
    return cast(BaseChatCompletionMessageParam, message)


def from_openai_chat_completion_choice_delta(delta: BaseChoiceDelta) -> ChoiceDelta:
    return ChoiceDelta(**delta.dict())
