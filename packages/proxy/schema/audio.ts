import { z } from "zod";

export const audioCodecSchema = z
  .discriminatedUnion("name", [
    z.object({
      name: z.literal("pcm"),
      byte_order: z.enum(["little", "big"]).default("little"),
      number_encoding: z.enum(["int", "float"]).default("int"),
    }),
    z.object({
      name: z.literal("g711"),
      algorithm: z.enum(["a", "mu"]),
    }),
    // z.object({
    //   name: z.literal("mp3"),
    // })
  ])
  .and(
    z.object({
      // Common codec parameters.
      channels: z.number().nonnegative().int(),
      sample_rate: z.number().nonnegative().int(),
      bits_per_sample: z.number().nonnegative().int(),
    }),
  );

export type AudioCodec = z.infer<typeof audioCodecSchema>;
