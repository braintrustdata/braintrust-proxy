import { describe, expect, it } from "vitest";
import { checkModelResearch } from "./check_model_research";

const success = { type: "result", subtype: "success", is_error: false };

describe("checkModelResearch", () => {
  it("accepts successful research, including a verified no-change outcome", () => {
    expect(() => checkModelResearch([success])).not.toThrow();
  });

  it.each(["WebFetch", "WebSearch", "Agent"])(
    "blocks a failed %s even when the agent reports success",
    (tool) => {
      expect(() =>
        checkModelResearch([
          {
            type: "assistant",
            message: {
              content: [{ type: "tool_use", name: tool, id: "research" }],
            },
          },
          {
            type: "user",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "research",
                  is_error: true,
                  content:
                    'HTTP 400: To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}.',
                },
              ],
            },
          },
          success,
        ]),
      ).toThrow("API or tool error");
    },
  );

  it("blocks delegated API errors", () => {
    expect(() =>
      checkModelResearch([
        {
          type: "assistant",
          error: "invalid_request",
          parent_tool_use_id: "agent",
        },
        success,
      ]),
    ).toThrow("API or tool error");
  });

  it.each([
    [],
    [{ type: "result", subtype: "error_max_turns", is_error: true }],
    [{ type: "result", subtype: "success", is_error: true }],
    [{ type: "result", subtype: "success" }],
  ])("blocks incomplete or failed execution: %j", (...messages) => {
    expect(() => checkModelResearch(messages)).toThrow();
  });

  it("rejects malformed transcripts", () => {
    expect(() => checkModelResearch({})).toThrow();
  });
});
