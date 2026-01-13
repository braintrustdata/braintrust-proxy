import { describe, expect, it } from "vitest";
import {
  isMediaTypeSupported,
  isImageMediaType,
  isTextBasedMediaType,
  getAvailableModels,
  type ModelFormat,
  type ModelSpec,
} from "./index";

describe("media-types helpers for playground file upload validation", () => {
  describe("isMediaTypeSupported - validates file uploads by model format", () => {
    it("should allow PDFs for all major providers except js/window", () => {
      const pdfMimeType = "application/pdf";

      expect(isMediaTypeSupported(pdfMimeType, "openai")).toBe(true);
      expect(isMediaTypeSupported(pdfMimeType, "anthropic")).toBe(true);
      expect(isMediaTypeSupported(pdfMimeType, "google")).toBe(true);
      expect(isMediaTypeSupported(pdfMimeType, "converse")).toBe(true);

      expect(isMediaTypeSupported(pdfMimeType, "js")).toBe(false);
      expect(isMediaTypeSupported(pdfMimeType, "window")).toBe(false);
    });

    it("should allow common images for google but not heic/heif for openai/anthropic", () => {
      expect(isMediaTypeSupported("image/jpeg", "google")).toBe(true);
      expect(isMediaTypeSupported("image/png", "google")).toBe(true);
      expect(isMediaTypeSupported("image/webp", "google")).toBe(true);
      expect(isMediaTypeSupported("image/heic", "google")).toBe(true);

      expect(isMediaTypeSupported("image/jpeg", "openai")).toBe(false);
      expect(isMediaTypeSupported("image/heic", "openai")).toBe(true);
      expect(isMediaTypeSupported("image/heif", "openai")).toBe(true);
    });

    it("should allow text-based files only for anthropic and google", () => {
      const textMimeTypes = [
        "text/plain",
        "text/markdown",
        "text/csv",
        "application/json",
      ];

      for (const mimeType of textMimeTypes) {
        expect(isMediaTypeSupported(mimeType, "google")).toBe(true);
        expect(isMediaTypeSupported(mimeType, "anthropic")).toBe(true);
        expect(isMediaTypeSupported(mimeType, "openai")).toBe(false);
      }
    });

    it("should allow audio/video only for google", () => {
      expect(isMediaTypeSupported("audio/mp3", "google")).toBe(true);
      expect(isMediaTypeSupported("audio/wav", "google")).toBe(true);
      expect(isMediaTypeSupported("video/mp4", "google")).toBe(true);

      expect(isMediaTypeSupported("audio/mp3", "openai")).toBe(false);
      expect(isMediaTypeSupported("audio/mp3", "anthropic")).toBe(false);
      expect(isMediaTypeSupported("video/mp4", "openai")).toBe(false);
      expect(isMediaTypeSupported("video/mp4", "anthropic")).toBe(false);
    });
  });

  describe("frontend playground file upload scenario", () => {
    function getModelFormat(modelName: string): ModelFormat | undefined {
      const models = getAvailableModels();
      return models[modelName]?.format;
    }

    function canUploadFile(
      file: { name: string; type: string },
      modelName: string,
    ): { allowed: boolean; reason?: string } {
      const format = getModelFormat(modelName);
      if (!format) {
        return { allowed: false, reason: `Unknown model: ${modelName}` };
      }

      if (!file.type) {
        return { allowed: false, reason: "File has no MIME type" };
      }

      const supported = isMediaTypeSupported(file.type, format);
      if (!supported) {
        return {
          allowed: false,
          reason: `${file.type} is not supported by ${format} models`,
        };
      }

      return { allowed: true };
    }

    it("should allow PDF upload when using gpt-5-mini (openai format)", () => {
      const pdfFile = { name: "document.pdf", type: "application/pdf" };
      const result = canUploadFile(pdfFile, "gpt-5-mini");
      expect(result.allowed).toBe(true);
    });

    it("should reject video upload when using gpt-5-mini (openai format)", () => {
      const videoFile = { name: "video.mp4", type: "video/mp4" };
      const result = canUploadFile(videoFile, "gpt-5-mini");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not supported by openai");
    });

    it("should allow video upload when using gemini-2.0-flash (google format)", () => {
      const videoFile = { name: "video.mp4", type: "video/mp4" };
      const result = canUploadFile(videoFile, "gemini-2.0-flash");
      expect(result.allowed).toBe(true);
    });

    it("should allow text/markdown upload for claude-sonnet-4-5 (anthropic format)", () => {
      const markdownFile = { name: "readme.md", type: "text/markdown" };
      const result = canUploadFile(markdownFile, "claude-sonnet-4-5");
      expect(result.allowed).toBe(true);
    });

    it("should reject text/markdown upload for gpt-5-mini (openai format)", () => {
      const markdownFile = { name: "readme.md", type: "text/markdown" };
      const result = canUploadFile(markdownFile, "gpt-5-mini");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("text/markdown is not supported");
    });

    it("should handle unknown models gracefully", () => {
      const pdfFile = { name: "document.pdf", type: "application/pdf" };
      const result = canUploadFile(pdfFile, "nonexistent-model");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Unknown model: nonexistent-model");
    });
  });

  describe("isImageMediaType - type guard for image files", () => {
    it("should return true for standard image types", () => {
      expect(isImageMediaType("image/jpeg")).toBe(true);
      expect(isImageMediaType("image/png")).toBe(true);
      expect(isImageMediaType("image/gif")).toBe(true);
      expect(isImageMediaType("image/webp")).toBe(true);
    });

    it("should return false for non-image types", () => {
      expect(isImageMediaType("application/pdf")).toBe(false);
      expect(isImageMediaType("text/plain")).toBe(false);
      expect(isImageMediaType("video/mp4")).toBe(false);
    });
  });

  describe("isTextBasedMediaType - type guard for text files", () => {
    it("should return true for text/* mime types", () => {
      expect(isTextBasedMediaType("text/plain")).toBe(true);
      expect(isTextBasedMediaType("text/markdown")).toBe(true);
      expect(isTextBasedMediaType("text/csv")).toBe(true);
      expect(isTextBasedMediaType("text/html")).toBe(true);
    });

    it("should return true for application types that are text-based", () => {
      expect(isTextBasedMediaType("application/json")).toBe(true);
      expect(isTextBasedMediaType("application/xml")).toBe(true);
      expect(isTextBasedMediaType("application/yaml")).toBe(true);
    });

    it("should return false for binary types", () => {
      expect(isTextBasedMediaType("application/pdf")).toBe(false);
      expect(isTextBasedMediaType("image/png")).toBe(false);
      expect(isTextBasedMediaType("audio/mp3")).toBe(false);
    });
  });
});
