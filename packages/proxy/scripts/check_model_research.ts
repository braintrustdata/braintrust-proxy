import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { z } from "zod";

const executionSchema = z.array(
  z.object({
    type: z.string(),
    subtype: z.string().optional(),
    is_error: z.boolean().optional(),
    error: z.unknown().optional(),
    message: z
      .object({
        content: z.union([
          z.string(),
          z.array(
            z.object({
              type: z.string(),
              is_error: z.boolean().optional(),
            }),
          ),
        ]),
      })
      .optional(),
  }),
);

export function checkModelResearch(execution: unknown): void {
  const messages = executionSchema.parse(execution);
  for (const message of messages) {
    if (
      message.is_error ||
      message.error ||
      (Array.isArray(message.message?.content) &&
        message.message.content.some((block) => block.is_error))
    ) {
      throw new Error(
        "Model research encountered an API or tool error; inspect the Claude execution report before retrying.",
      );
    }
  }
  const result = messages.find((message) => message.type === "result");
  if (result?.subtype !== "success" || result.is_error !== false) {
    throw new Error("Model research did not complete successfully.");
  }
}

const entryPointPath = process.argv[1];
if (entryPointPath && import.meta.url === pathToFileURL(entryPointPath).href) {
  const executionFile = process.env.EXECUTION_FILE;
  if (!executionFile) {
    throw new Error(
      "Missing Claude execution file; cannot verify model research.",
    );
  }
  checkModelResearch(JSON.parse(readFileSync(executionFile, "utf8")));
}
