import { Span, resumeSpan, noopSpan } from "braintrust";

const PARENT_SPAN_HEADER = "x-bt-parent-span";
const SERIALIZED_STATE_HEADER = "x-bt-serialized-state";

const URL_TO_SPAN_NAME: Record<string, string> = {
  "/chat/completions": "Chat Completion",
};

// Returns `noopSpan` if there is no span to resume or we are not tracing this
// request URL. The returned span must be flushed and ended manually.
export function resumeSpanFromHeaders(
  url: string,
  headers: Record<string, string>,
): Span {
  if (
    !(
      PARENT_SPAN_HEADER in headers &&
      SERIALIZED_STATE_HEADER in headers &&
      url in URL_TO_SPAN_NAME
    )
  ) {
    return noopSpan;
  }
  const rootSpan = resumeSpan(headers[PARENT_SPAN_HEADER], {
    serializedLoginInfo: headers[SERIALIZED_STATE_HEADER],
    flushOnExit: false,
  });
  return rootSpan.startSpan(URL_TO_SPAN_NAME[url]);
  // It shouldn't matter that we didn't end the resumed root span, because the
  // caller is expected to end it.
}

function parseStreamingOutput(body: string): Record<string, unknown> {
  // Each entry should be on its own line. It is a server-side event of the form
  // decoded in
  // https://github.com/florimondmanca/httpx-sse/blob/master/src/httpx_sse/_decoders.py.
  // We produce an output collecting server-side-events of type 'data'.

  const output: unknown[] = [];

  for (let line of body.split("\n")) {
    line = line.trim();
    const splitIndex = line.indexOf(":");
    if (splitIndex === -1) {
      continue;
    }

    const fieldName = line.slice(0, splitIndex).trim();
    if (fieldName !== "data") {
      continue;
    }

    let value = line.slice(splitIndex + 1).trim();
    if (value === "[DONE]") {
      break;
    }
    try {
      value = JSON.parse(value);
    } catch (_e) {}
    output.push(value);
  }

  return { output };
}

function parseNonStreamingOutput(body: string): Record<string, unknown> {
  try {
    const output = JSON.parse(body);
    const { choices, usage } = output;
    if (choices && usage) {
      return {
        output: choices,
        metrics: {
          total_tokens: usage.total_tokens,
          prompt_tokens: usage.prompt_tokens,
          completion_tokens: usage.completion_tokens,
        },
      };
    } else {
      return { output };
    }
  } catch (_e) {
    return { output: body };
  }
}

export function logOutput(span: Span, body: string, isStreamRequest: boolean) {
  if (span === noopSpan) return;
  span.log(
    isStreamRequest
      ? parseStreamingOutput(body)
      : parseNonStreamingOutput(body),
  );
}
