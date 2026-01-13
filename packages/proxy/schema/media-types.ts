import type { ModelFormat, ModelName } from "./models";

const IMAGE_MEDIA_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/tiff",
  "image/bmp",
] as const;

export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

const TEXT_BASED_TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/html",
  "text/css",
  "text/csv",
  "text/javascript",
  "text/xml",
  "text/yaml",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/yaml",
  "application/x-yaml",
] as const;

export type TextBasedTextType = (typeof TEXT_BASED_TEXT_TYPES)[number];

const DOCUMENT_MEDIA_TYPES = ["application/pdf"] as const;

const AUDIO_MEDIA_TYPES = [
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/mp4",
  "audio/webm",
] as const;

const VIDEO_MEDIA_TYPES = [
  "video/mp4",
  "video/webm",
  "video/mpeg",
  "video/quicktime",
  "video/x-msvideo",
] as const;

const SupportedMediaTypes = [
  ...IMAGE_MEDIA_TYPES,
  ...DOCUMENT_MEDIA_TYPES,
  ...TEXT_BASED_TEXT_TYPES,
  ...AUDIO_MEDIA_TYPES,
  ...VIDEO_MEDIA_TYPES,
] as const;

type SupportedMediaType = (typeof SupportedMediaTypes)[number];

export function isTextBasedMediaType(
  mediaType: string,
): mediaType is TextBasedTextType {
  return (
    mediaType.startsWith("text/") ||
    TEXT_BASED_TEXT_TYPES.includes(mediaType as TextBasedTextType)
  );
}

export function isImageMediaType(
  mediaType: string,
): mediaType is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(mediaType as ImageMediaType);
}

type MediaTypeSupport = {
  [mediaType in SupportedMediaType]?: boolean;
};

const toMediaTypeSupport = (
  mediaTypes: readonly SupportedMediaType[],
): MediaTypeSupport => {
  return mediaTypes.reduce(
    (acc, type) => {
      acc[type] = true;
      return acc;
    },
    {} as Record<string, boolean>,
  );
};

const ModelFormatMediaTypes: {
  [format in ModelFormat]: MediaTypeSupport;
} = {
  openai: {
    ...toMediaTypeSupport(
      IMAGE_MEDIA_TYPES.filter(
        (type) => type.endsWith("heic") || type.endsWith("heif"),
      ),
    ),
    ...toMediaTypeSupport(DOCUMENT_MEDIA_TYPES),
  },
  anthropic: {
    ...toMediaTypeSupport(
      IMAGE_MEDIA_TYPES.filter(
        (type) => type.endsWith("heic") || type.endsWith("heif"),
      ),
    ),
    ...toMediaTypeSupport(TEXT_BASED_TEXT_TYPES),
    ...toMediaTypeSupport(DOCUMENT_MEDIA_TYPES),
  },
  google: {
    ...toMediaTypeSupport(IMAGE_MEDIA_TYPES),
    ...toMediaTypeSupport(TEXT_BASED_TEXT_TYPES),
    ...toMediaTypeSupport(DOCUMENT_MEDIA_TYPES),
    ...toMediaTypeSupport(AUDIO_MEDIA_TYPES),
    ...toMediaTypeSupport(VIDEO_MEDIA_TYPES),
  },
  converse: {
    ...toMediaTypeSupport(
      IMAGE_MEDIA_TYPES.filter(
        (type) => type.endsWith("heic") || type.endsWith("heif"),
      ),
    ),
    ...toMediaTypeSupport(DOCUMENT_MEDIA_TYPES),
  },
  js: {},
  window: {},
};

/**
 * Overrides for specific models to support additional media types.
 */
const ModelMediaTypeOverrides: {
  [model in ModelName]?: MediaTypeSupport;
} = {
  // will be useful for gpt-audio
};

export function isMediaTypeSupported(
  mediaType: string,
  format: ModelFormat,
  model?: ModelName,
): boolean {
  const baseSupport = { ...ModelFormatMediaTypes[format] };

  if (model && ModelMediaTypeOverrides[model]) {
    Object.assign(baseSupport, ModelMediaTypeOverrides[model]);
  }

  return baseSupport[mediaType as SupportedMediaType] === true;
}
