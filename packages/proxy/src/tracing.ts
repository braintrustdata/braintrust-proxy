import { Span, startSpanUnderSerialized, noopSpan } from "braintrust";

const URL_TO_SPAN_NAME: Record<string, string> = {
  "/chat/completions": "Chat Completion",
};

// Returns `noopSpan` if there is no span to resume or we are not tracing this
// request URL. The returned span must be flushed and ended manually.
export function startSpanFromHeaders({
  url,
  orgNameHeader,
  parentSpanHeader,
  authToken,
  apiUrl,
}: {
  url: string;
  orgNameHeader: string | undefined;
  parentSpanHeader: string | undefined;
  authToken: string;
  apiUrl: string | undefined;
}): Span {
  if (
    !(orgNameHeader && parentSpanHeader && apiUrl && url in URL_TO_SPAN_NAME)
  ) {
    return noopSpan;
  }
  return startSpanUnderSerialized(parentSpanHeader, URL_TO_SPAN_NAME[url], {
    logUrl: apiUrl,
    logToken: authToken,
    flushOnExit: false,
  });
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
