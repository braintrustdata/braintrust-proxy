import {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
  OpenAIChatCompletionCreateParams,
} from "@types";
import { bypass, http, HttpResponse, JsonBodyType } from "msw";
import { setupServer } from "msw/node";
import { ChatCompletionContentPart } from "openai/resources";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  test,
  vi,
} from "vitest";
import { callProxyV1 } from "../../utils/tests";
import * as proxyUtil from "../util";
import { normalizeOpenAIContent } from "./openai";
import * as util from "./util";

it("should deny reasoning_effort for unsupported models non-streaming", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "gpt-4o-mini",
      reasoning_effort: "high",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a short joke about programming." },
      ],
      stream: true,
      max_tokens: 150,
    },
    proxyHeaders: {
      "x-bt-endpoint-name": "openai",
    },
  });

  expect(json()).toEqual({
    error: {
      message: "Unrecognized request argument supplied: reasoning_effort",
      type: "invalid_request_error",
      param: null,
      code: null,
    },
  });
});

it("should deny reasoning_effort for unsupported models non-streaming", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletion
  >({
    body: {
      model: "gpt-4o-mini",
      reasoning_effort: "high",
      messages: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Tell me a short joke about programming." },
      ],
      stream: false,
      max_tokens: 150,
    },
    proxyHeaders: {
      "x-bt-endpoint-name": "openai",
    },
  });

  expect(json()).toEqual({
    error: {
      message: "Unrecognized request argument supplied: reasoning_effort",
      type: "invalid_request_error",
      param: null,
      code: null,
    },
  });
});

it("should accept and return reasoning/thinking params and detail streaming", async () => {
  const { events } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "o3-mini-2025-01-31",
      reasoning_effort: "medium",
      messages: [
        {
          role: "user",
          content: "How many rs in 'ferrocarril'",
        },
        {
          role: "assistant",
          content: "There are 4 letter 'r's in the word \"ferrocarril\".",
          refusal: null,
          reasoning: [
            {
              id: "",
              content:
                "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
            },
          ],
        },
        {
          role: "user",
          content: "How many e in what you said?",
        },
      ],
      stream: true,
    },
    proxyHeaders: {
      "x-bt-endpoint-name": "openai",
    },
  });

  const streamedEvents = events();
  expect(streamedEvents.length).toBeGreaterThan(0);

  const hasContent = streamedEvents.some(
    (event) => event.data.choices[0]?.delta?.content !== undefined,
  );
  expect(hasContent).toBe(true);

  const hasReasoning = streamedEvents.some(
    (event) => event.data.choices[0]?.delta?.reasoning?.content !== undefined,
  );
  expect(hasReasoning).toBe(false); // as of writing, openai is not providing this detail!
});

it("should accept and return reasoning/thinking params and detail non-streaming", async () => {
  const { json } = await callProxyV1<
    OpenAIChatCompletionCreateParams,
    OpenAIChatCompletionChunk
  >({
    body: {
      model: "o3-mini-2025-01-31",
      reasoning_effort: "medium",
      stream: false,
      messages: [
        {
          role: "user",
          content: "How many rs in 'ferrocarril'",
        },
        {
          role: "assistant",
          content: "There are 4 letter 'r's in the word \"ferrocarril\".",
          refusal: null,
          reasoning: [
            {
              id: "",
              content:
                "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
            },
          ],
        },
        {
          role: "user",
          content: "How many e in what you said?",
        },
      ],
    },
    proxyHeaders: {
      "x-bt-endpoint-name": "openai",
    },
  });

  expect(json()).toEqual({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        message: {
          content: expect.any(String),
          // as of writing, openai does not provide this detail
          // reasoning: [],
          annotations: [],
          refusal: null,
          role: "assistant",
        },
      },
    ],
    created: expect.any(Number),
    id: expect.any(String),
    model: "o3-mini-2025-01-31",
    object: "chat.completion",
    service_tier: expect.any(String),
    system_fingerprint: expect.any(String),
    usage: {
      completion_tokens: expect.any(Number),
      prompt_tokens: expect.any(Number),
      total_tokens: expect.any(Number),
      completion_tokens_details: {
        accepted_prediction_tokens: expect.any(Number),
        audio_tokens: expect.any(Number),
        reasoning_tokens: expect.any(Number),
        rejected_prediction_tokens: expect.any(Number),
      },
      prompt_tokens_details: {
        audio_tokens: expect.any(Number),
        cached_tokens: expect.any(Number),
      },
    },
  });
});

type InterceptedRequest = {
  method: string;
  url: string;
  body: JsonBodyType;
};

type InterceptedResponse = {
  status: number;
  body: JsonBodyType;
};

type InterceptedCall = {
  request: InterceptedRequest;
  response: InterceptedResponse;
};

describe("request/response checking", () => {
  const server = setupServer();

  beforeAll(() => {
    server.listen({
      onUnhandledRequest: () => {
        throw new Error("Unexpected request");
      },
    });
  });

  afterEach(() => {
    server.resetHandlers();
  });

  afterAll(() => {
    server.close();
  });

  it("should fallback to medium if reasoning_effort is missing", async () => {
    const calls: InterceptedCall[] = [];
    server.use(
      http.post(
        "https://api.openai.com/v1/chat/completions",
        async ({ request: req }) => {
          const request: InterceptedRequest = {
            method: req.method,
            url: req.url,
            body: await req.json(),
          };

          const res = await fetch(
            bypass(
              new Request(req.url, {
                method: req.method,
                body: JSON.stringify(request.body),
                headers: req.headers,
              }),
            ),
          );

          const response: InterceptedResponse = {
            status: res.status,
            body: await res.json(),
          };

          calls.push({ request, response });

          return HttpResponse.json(response.body, {
            status: res.status,
            headers: res.headers,
          });
        },
      ),
    );

    const { json } = await callProxyV1<
      OpenAIChatCompletionCreateParams,
      OpenAIChatCompletionChunk
    >({
      body: {
        model: "o3-mini-2025-01-31",
        reasoning_effort: null,
        stream: false,
        messages: [
          {
            role: "user",
            content: "How many rs in 'ferrocarril'",
          },
          {
            role: "assistant",
            content: "There are 4 letter 'r's in the word \"ferrocarril\".",
            refusal: null,
            reasoning: [
              {
                id: "",
                content:
                  "To count the number of 'r's in the word 'ferrocarril', I'll just go through the word letter by letter.\n\n'ferrocarril' has the following letters:\nf-e-r-r-o-c-a-r-r-i-l\n\nLooking at each letter:\n- 'f': not an 'r'\n- 'e': not an 'r'\n- 'r': This is an 'r', so that's 1.\n- 'r': This is an 'r', so that's 2.\n- 'o': not an 'r'\n- 'c': not an 'r'\n- 'a': not an 'r'\n- 'r': This is an 'r', so that's 3.\n- 'r': This is an 'r', so that's 4.\n- 'i': not an 'r'\n- 'l': not an 'r'\n\nSo there are 4 'r's in the word 'ferrocarril'.",
              },
            ],
          },
          {
            role: "user",
            content: "How many e in what you said?",
          },
        ],
      },
      proxyHeaders: {
        "x-bt-endpoint-name": "openai",
      },
    });

    expect(json()).toEqual({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: expect.any(String),
            // as of writing, openai does not provide this detail
            // reasoning: [],
            annotations: [],
            refusal: null,
            role: "assistant",
          },
        },
      ],
      created: expect.any(Number),
      id: expect.any(String),
      model: "o3-mini-2025-01-31",
      object: "chat.completion",
      service_tier: expect.any(String),
      system_fingerprint: expect.any(String),
      usage: {
        completion_tokens: expect.any(Number),
        prompt_tokens: expect.any(Number),
        total_tokens: expect.any(Number),
        completion_tokens_details: {
          accepted_prediction_tokens: expect.any(Number),
          audio_tokens: expect.any(Number),
          reasoning_tokens: expect.any(Number),
          rejected_prediction_tokens: expect.any(Number),
        },
        prompt_tokens_details: {
          audio_tokens: expect.any(Number),
          cached_tokens: expect.any(Number),
        },
      },
    });

    expect(calls).toEqual([
      {
        request: {
          body: {
            reasoning_effort: null, // let openai decide what is the default
            messages: [
              {
                content: "How many rs in 'ferrocarril'",
                role: "user",
              },
              {
                content: "There are 4 letter 'r's in the word \"ferrocarril\".",
                refusal: null,
                role: "assistant",
              },
              {
                content: "How many e in what you said?",
                role: "user",
              },
            ],
            model: "o3-mini-2025-01-31",
            stream: false,
          },
          method: "POST",
          url: "https://api.openai.com/v1/chat/completions",
        },
        response: {
          body: {
            choices: [
              {
                finish_reason: "stop",
                index: 0,
                message: {
                  annotations: [],
                  content: expect.any(String),
                  refusal: null,
                  role: "assistant",
                },
              },
            ],
            created: expect.any(Number),
            id: expect.any(String),
            model: "o3-mini-2025-01-31",
            object: "chat.completion",
            service_tier: "default",
            system_fingerprint: expect.any(String),
            usage: {
              completion_tokens: expect.any(Number),
              completion_tokens_details: {
                accepted_prediction_tokens: expect.any(Number),
                audio_tokens: expect.any(Number),
                reasoning_tokens: expect.any(Number),
                rejected_prediction_tokens: expect.any(Number),
              },
              prompt_tokens: expect.any(Number),
              prompt_tokens_details: {
                audio_tokens: expect.any(Number),
                cached_tokens: expect.any(Number),
              },
              total_tokens: expect.any(Number),
            },
          },
          status: 200,
        },
      },
    ]);
  });
});

const mockBase64Data = "AF1231KF==";

describe("normalizeOpenAIContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("should pass through string content", async () => {
    const content = "This is a simple string.";
    // The function has a `typeof content === "string"` check,
    // though its signature expects ChatCompletionContentPart.
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions, @typescript-eslint/no-explicit-any
    const result = await normalizeOpenAIContent(content as any);
    expect(result).toBe(content);
  });

  test("should pass through text content part", async () => {
    const content: ChatCompletionContentPart = {
      type: "text",
      text: "This is text content.",
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(content);
  });

  test("should pass through base64 encoded PNG image (image_url type) directly", async () => {
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA" },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(content);
  });

  test("should pass through base64 encoded JPEG image (image_url type) directly", async () => {
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/" },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(content);
  });

  test("should convert base64 encoded PDF (image_url type) to a file block", async () => {
    const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQKJ==";
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: pdfDataUrl },
    };
    const expectedOutput = {
      type: "file",
      file: {
        filename: "file_from_base64",
        file_data: pdfDataUrl, // Uses the original data URL
      },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(expectedOutput);
  });

  test("should convert a .pdf file URL (identified by filename) to a file block", async () => {
    const spyConvertMediaToBase64 = vi
      .spyOn(util, "convertMediaToBase64")
      .mockResolvedValue({
        media_type: "application/pdf",
        data: mockBase64Data,
      });
    const fileUrl = "https://example.com/another.pdf";
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: fileUrl },
    };

    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual({
      type: "file",
      file: {
        filename: "another.pdf",
        file_data: `data:application/pdf;base64,${mockBase64Data}`,
      },
    });
    expect(spyConvertMediaToBase64).toHaveBeenCalledWith({
      media: fileUrl,
      allowedMediaTypes: ["application/pdf"],
      maxMediaBytes: 20 * 1024 * 1024,
    });
  });

  test("should convert a PDF file URL (identified by contentType) to a file block", async () => {
    const spyParseFileMetadataFromUrl = vi
      .spyOn(proxyUtil, "parseFileMetadataFromUrl")
      .mockReturnValue({
        filename: "document",
        contentType: "application/pdf",
        url: new URL("https://example.com/document"),
      });
    const spyConvertMediaToBase64 = vi
      .spyOn(util, "convertMediaToBase64")
      .mockResolvedValue({
        media_type: "application/pdf",
        data: mockBase64Data,
      });

    const fileUrl = "https://example.com/document";
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: fileUrl },
    };

    const expectedOutput = {
      type: "file",
      file: {
        filename: "document",
        file_data: `data:application/pdf;base64,${mockBase64Data}`,
      },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(expectedOutput);
    expect(spyConvertMediaToBase64).toHaveBeenCalledWith({
      media: fileUrl,
      allowedMediaTypes: ["application/pdf"],
      maxMediaBytes: 20 * 1024 * 1024,
    });
  });
});
