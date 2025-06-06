# Braintrust AI Proxy Python Client

The `braintrust-proxy` package provides Python types, Pydantic models, and helper functions to simplify interaction with the Braintrust AI proxy. By providing rich Python types that extend the OpenAI client types, it significantly enhances compatibility and developer experience, enabling features like typechecking and improved editor autocomplete when working with proxy-specific extensions (such as `reasoning`).

## Installation

You can install the package using `uv` (recommended) or `pip`:

Using `uv`:

```bash
uv pip install braintrust-proxy
```

Using `pip`:

```bash
pip install braintrust-proxy
```

## Usage

The package provides enhanced types and helper functions, such as `as_openai_chat_message_param`, to work with messages that might include proxy-specific extensions (like `reasoning`) while maintaining compatibility with standard OpenAI client inputs.

```python
import os
from openai import OpenAI
import json
from braintrust_proxy import as_openai_chat_message_param

# Initialize the OpenAI client pointing to the Braintrust proxy
# Ensure BRAINTRUST_API_URL and BRAINTRUST_API_KEY environment variables are set
client = OpenAI(
    # if self hosting, otherwise use the hosted API
    base_url=f"{os.getenv('BRAINTRUST_API_URL') or 'https://api.braintrust.dev'}/v1/proxy",
    api_key=os.getenv("BRAINTRUST_API_KEY"),
)

# Example using the helper function with a message that includes 'reasoning'
response = client.chat.completions.create(
    model="claude-3-7-sonnet-latest",
    reasoning_effort=None,
    stream=False,
    messages=[
        {
            "role": "user",
            "content": "How many rs in 'ferrocarril'",
        },
        as_openai_chat_message_param(
            {
                "role": "assistant",
                "content": "There are 4 letter 'r's in the word \"ferrocarril\".",
                "reasoning": [
                    {
                        "id": "",
                        "content": "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
                    },
                ],
            }
        ),
        {
            "role": "user",
            "content": "How many e in what you said?",
        },
    ],
)

print(
    json.dumps(
        {
            "message": response.choices[0].message.dict(),
            "reasoning": getattr(response.choices[0].message, "reasoning", None),
        },
        indent=2,
    )
)
```

### Streaming

```py
import os
from openai import OpenAI
import json
from braintrust_proxy import as_openai_chat_message_param, from_openai_chat_completion_choice_delta

# Initialize the OpenAI client pointing to the Braintrust proxy
# Ensure BRAINTRUST_API_URL and BRAINTRUST_API_KEY environment variables are set
client = OpenAI(
    # if self hosting, otherwise use the hosted API
    base_url=f"{os.getenv('BRAINTRUST_API_URL') or 'https://api.braintrust.dev'}/v1/proxy",
    api_key=os.getenv("BRAINTRUST_API_KEY"),
)

stream = client.chat.completions.create(
    model="claude-3-7-sonnet-latest",
    reasoning_effort="high",
    stream=True,
    messages=[
        {
            "role": "user",
            "content": "How many rs in 'ferrocarril'",
        },
        as_openai_chat_message_param(
            {
                "role": "assistant",
                "content": "There are 4 letter 'r's in the word \"ferrocarril\".",
                "reasoning": [
                    {
                        "id": "",
                        "content": "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
                    },
                ],
            }
        ),
        {
            "role": "user",
            "content": "How many e in what you said?",
        },
    ],
)

for event in stream:
    delta = from_openai_chat_completion_choice_delta(event.choices[0].delta)
    print(
        json.dumps(
            {"content": delta.content, "reasoning": delta.reasoning.dict() if delta.reasoning else None}, indent=2
        )
    )
```
