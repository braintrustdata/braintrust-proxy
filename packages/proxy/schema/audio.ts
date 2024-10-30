import { z } from "zod";

export const mp3BitrateSchema = z.union([
  z.literal(8),
  z.literal(16),
  z.literal(24),
  z.literal(32),
  z.literal(40),
  z.literal(48),
  z.literal(64),
  z.literal(80),
  z.literal(96),
  z.literal(112),
  z.literal(128),
  z.literal(160),
  z.literal(192),
  z.literal(224),
  z.literal(256),
  z.literal(320),
]);

export type Mp3Bitrate = z.infer<typeof mp3BitrateSchema>;

export const pcmAudioFormatSchema = z
  .discriminatedUnion("name", [
    z.object({
      name: z.literal("pcm"),
      byte_order: z.enum(["little", "big"]).default("little"),
      number_encoding: z.enum(["int", "float"]).default("int"),
      bits_per_sample: z.number().nonnegative().int(),
    }),
    z.object({
      name: z.literal("g711"),
      algorithm: z.enum(["a", "mu"]),
    }),
  ])
  .and(
    z.object({
      // Common codec parameters.
      channels: z.literal(1).or(z.literal(2)),
      sample_rate: z.union([
        z.literal(8000),
        z.literal(11025),
        z.literal(12000),
        z.literal(16000),
        z.literal(22050),
        z.literal(24000),
        z.literal(32000),
        z.literal(44100),
        z.literal(48000),
      ]),
    }),
  );

export type PcmAudioFormat = z.infer<typeof pcmAudioFormatSchema>;
