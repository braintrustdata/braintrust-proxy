import { arrayBufferToBase64 } from "utils";

const base64ImagePattern =
  /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/;

export interface ImageBlock {
  media_type: string;
  data: string;
}

export function convertBase64Image(image: string): ImageBlock | null {
  const match = image.match(base64ImagePattern);
  if (!match) {
    return null;
  }

  const [, media_type, data] = match;
  return {
    media_type,
    data,
  };
}

async function convertImageUrl({
  url,
  allowedImageTypes,
  maxImageBytes,
}: {
  url: string;
  allowedImageTypes: string[];
  maxImageBytes: number | null;
}): Promise<ImageBlock> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (!contentType) {
    throw new Error("Failed to get content type of the image");
  }
  if (!allowedImageTypes.includes(contentType)) {
    throw new Error(`Unsupported image type: ${contentType}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (maxImageBytes !== null && arrayBuffer.byteLength > maxImageBytes) {
    throw new Error(
      `Image size exceeds the ${maxImageBytes / 1024 / 1024} MB limit`,
    );
  }

  const data = arrayBufferToBase64(arrayBuffer);

  return {
    media_type: contentType,
    data,
  };
}

export async function convertImageToBase64({
  image,
  allowedImageTypes,
  maxImageBytes,
}: {
  image: string;
  allowedImageTypes: string[];
  maxImageBytes: number | null;
}): Promise<ImageBlock> {
  const imageBlock = convertBase64Image(image);
  if (imageBlock) {
    return imageBlock;
  } else {
    return await convertImageUrl({
      url: image,
      allowedImageTypes,
      maxImageBytes,
    });
  }
}
