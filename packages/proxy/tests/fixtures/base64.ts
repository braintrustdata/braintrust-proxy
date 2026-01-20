import { readFileSync } from "fs";

const fileToBase64 = (filename: string, mimetype: string) =>
  `data:${mimetype};base64,${readFileSync(
    `${__dirname}/${filename}`,
    "base64",
  )}`;

export const IMAGE_DATA_URL = fileToBase64("image.png", "image/png");

export const PDF_DATA_URL = fileToBase64("file.pdf", "application/pdf");

export const TEXT_DATA_URL = fileToBase64("text.txt", "text/plain");

export const MD_DATA_URL = fileToBase64("text.md", "text/markdown");

export const CSV_DATA_URL = fileToBase64("muppets.csv", "text/csv");

export const AUDIO_DATA_URL = fileToBase64("audio.wav", "audio/wav");

export const VIDEO_DATA_URL = fileToBase64("video.mp4", "video/mp4");
