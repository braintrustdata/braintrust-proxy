from collections.abc import Iterable
from typing import TypedDict, Union, cast

from openai.types.chat.chat_completion_assistant_message_param import (
    ChatCompletionAssistantMessageParam as BaseChatCompletionAssistantMessageParam,
)
from openai.types.chat.chat_completion_message_param import (
    ChatCompletionMessageParam as BaseChatCompletionMessageParam,
)


class Reasoning(TypedDict):
    id: str | None
    content: str | None


class ChatCompletionAssistantMessageParam(BaseChatCompletionAssistantMessageParam):
    reasoning: Iterable[Reasoning] | None


ChatCompletionMessageParam = Union[
    BaseChatCompletionMessageParam, ChatCompletionAssistantMessageParam
]
