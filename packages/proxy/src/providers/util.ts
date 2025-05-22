import { arrayBufferToBase64 } from "utils";

const base64MediaPattern =
  /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+);base64,([A-Za-z0-9+/]+={0,2})$/;

interface MediaBlock {
  media_type: string;
  data: string;
}

export function convertBase64Media(media: string): MediaBlock | null {
  const match = media.match(base64MediaPattern);
  if (!match) {
    return null;
  }

  const [, media_type, data] = match;
  return {
    media_type,
    data,
  };
}

async function convertMediaUrl({
  url,
  allowedMediaTypes,
  maxMediaBytes,
}: {
  url: string;
  allowedMediaTypes: string[] | null;
  maxMediaBytes: number | null;
}): Promise<MediaBlock> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch media: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new Error("Failed to get content type of the media");
  }
  const baseContentType = contentType.split(";")[0].trim();
  if (
    allowedMediaTypes !== null &&
    !allowedMediaTypes.includes(baseContentType)
  ) {
    throw new Error(`Unsupported media type: ${baseContentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (maxMediaBytes !== null && arrayBuffer.byteLength > maxMediaBytes) {
    throw new Error(
      `Media size exceeds the ${maxMediaBytes / 1024 / 1024} MB limit`,
    );
  }

  const data = arrayBufferToBase64(arrayBuffer);

  return {
    media_type: baseContentType,
    data,
  };
}

export async function convertMediaToBase64({
  media,
  allowedMediaTypes,
  maxMediaBytes,
}: {
  media: string;
  allowedMediaTypes: string[] | null;
  maxMediaBytes: number | null;
}): Promise<MediaBlock> {
  const mediaBlock = convertBase64Media(media);
  if (mediaBlock) {
    return mediaBlock;
  } else {
    return await convertMediaUrl({
      url: media,
      allowedMediaTypes,
      maxMediaBytes,
    });
  }
}

export function base64ToUrl(base64: MediaBlock): string {
  return `data:${base64.media_type};base64,${base64.data}`;
}
