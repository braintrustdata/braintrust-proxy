from collections.abc import Iterable
from typing import (
    Optional,
    TypedDict,
    Union,
    cast,
)

from openai.types.chat.chat_completion_assistant_message_param import (
    ChatCompletionAssistantMessageParam as BaseChatCompletionAssistantMessageParam,
)
from openai.types.chat.chat_completion_message_param import (
    ChatCompletionMessageParam as BaseChatCompletionMessageParam,
)


class Reasoning(TypedDict):
    id: Optional[str]
    content: Optional[str]


class ChatCompletionAssistantMessageParam(BaseChatCompletionAssistantMessageParam):
    reasoning: Optional[Iterable[Reasoning]]


ChatCompletionMessageParam = Union[BaseChatCompletionMessageParam, ChatCompletionAssistantMessageParam]
