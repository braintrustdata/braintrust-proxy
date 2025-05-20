import { z } from "zod";

export const completionUsageSchema = z.object({
  completion_tokens: z.number(),
  prompt_tokens: z.number(),
  total_tokens: z.number(),
  completion_tokens_details: z
    .object({
      accepted_prediction_tokens: z.number().optional(),
      audio_tokens: z.number().optional(),
      reasoning_tokens: z.number().optional(),
      rejected_prediction_tokens: z.number().optional(),
    })
    .optional(),
  prompt_tokens_details: z
    .object({
      audio_tokens: z.number().optional(),
      cached_tokens: z.number().optional(),
      cache_creation_tokens: z
        .number()
        .optional()
        .describe(
          "Extension to support Anthropic `cache_creation_input_tokens`",
        ),
    })
    .optional(),
});

export type CompletionUsage = z.infer<typeof completionUsageSchema>;
