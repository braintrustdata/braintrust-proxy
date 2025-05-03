import { describe, test, expect } from "vitest";
import { translateParams } from "./index";
import { ModelFormat } from "./models";

type TranslateParamsCase =
  | {
      from: Record<string, unknown>;
      to: Record<string, unknown>;
    }
  | "skip";

describe("translateParams", () => {
  const temperature = 0.55;
  const max_tokens = 12345;
  const top_p = 0.123;
  const top_k = 45;
  const stop = ["\n"];
  const frequency_penalty = 0.1;
  const presence_penalty = 0.2;
  const n = 2;

  const matrix: Record<
    ModelFormat,
    Record<ModelFormat, TranslateParamsCase>
  > = {
    openai: {
      openai: "skip",
      anthropic: {
        from: {
          temperature,
          max_tokens,
          top_p,
          stop,
          frequency_penalty,
          presence_penalty,
          n,
        },
        to: { temperature, max_tokens, top_p, stop_sequences: stop },
      },
      google: {
        from: {
          temperature,
          max_tokens,
          top_p,
          stop,
          frequency_penalty,
          presence_penalty,
          n,
        },
        to: { temperature, maxOutputTokens: max_tokens, topP: top_p },
      },
      window: {
        from: {
          temperature,
          max_tokens,
          top_p,
          stop,
          frequency_penalty,
          presence_penalty,
          n,
        },
        to: { temperature },
      },
      converse: {
        from: {
          temperature,
          max_tokens,
          top_p,
          stop,
          frequency_penalty,
          presence_penalty,
          n,
        },
        to: {
          temperature,
          maxTokens: max_tokens,
          topP: top_p,
          stopSequences: stop,
        },
      },
      js: {
        from: {
          temperature,
          max_tokens,
          top_p,
          stop,
          frequency_penalty,
          presence_penalty,
          n,
        },
        to: {},
      },
    },
    anthropic: {
      openai: {
        from: { temperature, max_tokens, top_p, top_k, stop_sequences: stop },
        to: { temperature, max_tokens, top_p, stop },
      },
      anthropic: "skip",
      google: {
        from: { temperature, max_tokens, top_p, top_k, stop_sequences: stop },
        to: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: top_p,
          topK: top_k,
        },
      },
      window: {
        from: { temperature, max_tokens, top_p, top_k, stop_sequences: stop },
        to: { temperature, topK: top_k },
      },
      converse: {
        from: { temperature, max_tokens, top_p, top_k, stop_sequences: stop },
        to: {
          temperature,
          maxTokens: max_tokens,
          topP: top_p,
          topK: top_k,
          stopSequences: stop,
        },
      },
      js: {
        from: { temperature, max_tokens, top_p, top_k, stop_sequences: stop },
        to: {},
      },
    },
    google: {
      openai: {
        from: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: top_p,
          topK: top_k,
        },
        to: { temperature, max_tokens, top_p },
      },
      anthropic: {
        from: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: top_p,
          topK: top_k,
        },
        to: { temperature, max_tokens, top_p, top_k },
      },
      google: "skip",
      window: {
        from: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: top_p,
          topK: top_k,
        },
        to: { temperature, topK: top_k },
      },
      converse: {
        from: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: top_p,
          topK: top_k,
        },
        to: { temperature, maxTokens: max_tokens, topP: top_p, topK: top_k },
      },
      js: {
        from: {
          temperature,
          maxOutputTokens: max_tokens,
          topP: top_p,
          topK: top_k,
        },
        to: {},
      },
    },
    window: {
      openai: {
        from: { temperature, topK: top_k },
        to: { temperature },
      },
      anthropic: {
        from: { temperature, topK: top_k },
        to: { temperature, top_k },
      },
      google: {
        from: { temperature, topK: top_k },
        to: { temperature, topK: top_k },
      },
      window: "skip",
      converse: {
        from: { temperature, topK: top_k },
        to: { temperature, topK: top_k },
      },
      js: {
        from: { temperature, topK: top_k },
        to: {},
      },
    },
    converse: {
      openai: {
        from: {
          temperature,
          maxTokens: max_tokens,
          topK: top_k,
          topP: top_p,
          stopSequences: ["\n"],
        },
        to: { temperature, max_tokens, top_p, stop },
      },
      anthropic: {
        from: {
          temperature,
          maxTokens: max_tokens,
          topK: top_k,
          topP: top_p,
          stopSequences: ["\n"],
        },
        to: { temperature, max_tokens, top_k, top_p, stop_sequences: stop },
      },
      google: {
        from: {
          temperature,
          maxTokens: max_tokens,
          topK: top_k,
          topP: top_p,
          stopSequences: ["\n"],
        },
        to: {
          temperature,
          maxOutputTokens: max_tokens,
          topK: top_k,
          topP: top_p,
        },
      },
      window: {
        from: {
          temperature,
          maxTokems: max_tokens,
          topK: top_k,
          topP: top_p,
          stopSequences: ["\n"],
        },
        to: { temperature, topK: top_k },
      },
      converse: "skip",
      js: {
        from: { temperature, topK: top_k },
        to: {},
      },
    },
    js: {
      openai: {
        from: { some_param: "foo" },
        to: {},
      },
      anthropic: {
        from: { some_param: "foo" },
        to: {},
      },
      google: {
        from: { some_param: "foo" },
        to: {},
      },
      window: {
        from: { some_param: "foo" },
        to: {},
      },
      converse: {
        from: { some_param: "foo" },
        to: {},
      },
      js: "skip",
    },
  };

  test.each(
    Object.entries(matrix).flatMap(([fromProvider, toParams]) =>
      Object.entries(toParams).flatMap(([toProvider, args]) => {
        if (args === "skip") {
          // XXX maybe test roundtrip?
          return [];
        } else {
          return [
            {
              fromProvider: fromProvider as ModelFormat,
              toProvider: toProvider as ModelFormat,
              fromParams: args.from,
              toParams: args.to,
            },
          ];
        }
      }),
    ),
  )(
    "translateParams from $fromProvider to $toProvider",
    ({ fromProvider, toProvider, fromParams, toParams }) => {
      if (fromProvider === toProvider) {
        expect(translateParams(fromProvider, fromParams)).toEqual(toParams);
      } else {
        expect(translateParams(toProvider, fromParams)).toEqual(toParams);
      }
    },
  );

  /*
    test("openai -> anthropic", () => {
        expect(translateParams("openai", {
            temperature: 0.55,
            top_p: 0.245,
            max_tokens: 1000,
            frequency_penalty: 0.1,
            presence_penalty: 0.1,
            response_format: { type: "json_schema", schema: { type: "object" } },
            n: 1,
            stop: ["\n"],
            reasoning_effort: "low",
        })).toEqual({
            temperature: 0.55,
            top_p: 0.245,
            max_tokens: 1000,
            //stop_sequences: ["\n"],
        });
    });

    test("anthropic -> openai", () => {
        expect(translateParams("anthropic", {
            max_tokens: 1000,
            temperature: 0.5,
            top_p: 0.245,
            top_k: 54,
            stop_sequences: ["\n"],
        })).toEqual({
            temperature: 0.5,
            top_p: 0.245,
            top_k: 54,
            max_tokens: 1000,
            //stop: ["\n"],
        });
    });

    test("openai -> google", () => {
        expect(translateParams("google", {
            temperature: 0.55,
            top_p: 0.245,
            max_tokens: 1000,
            frequency_penalty: 0.1,
            presence_penalty: 0.1,
            response_format: { type: "json_schema", schema: { type: "object" } },
            n: 1,
            stop: ["\n"],
            reasoning_effort: "low",
        })).toEqual({
            temperature: 0.55,
            topP: 0.245,
            maxOutputTokens: 1000,
            //stop: ["\n"],
        });
    });
    */
});
