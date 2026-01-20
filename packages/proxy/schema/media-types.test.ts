import { describe, expect, it } from "vitest";
import {
  isMediaTypeSupported,
  getSupportedMediaTypes,
  isImageMediaType,
  isTextBasedMediaType,
  getAvailableModels,
  type ModelFormat,
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

      expect(isMediaTypeSupported("image/jpeg", "openai")).toBe(true);
      expect(isMediaTypeSupported("image/heic", "openai")).toBe(false);
      expect(isMediaTypeSupported("image/heif", "openai")).toBe(false);
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
    ): { allowed: boolean; reason?: string; allowedTypes?: Set<string> } {
      const format = getModelFormat(modelName);
      if (!format) {
        return { allowed: false, reason: `Unknown model: ${modelName}` };
      }

      if (!file.type) {
        return { allowed: false, reason: "File has no MIME type" };
      }

      const allowedTypes = getSupportedMediaTypes(format);

      if (!allowedTypes.has(file.type)) {
        return {
          allowed: false,
          reason: `${file.type} is not supported by ${format} models`,
          allowedTypes,
        };
      }

      return { allowed: true, allowedTypes };
    }

    it("should allow PDF upload when using gpt-5-mini (openai format)", () => {
      const pdfFile = { name: "document.pdf", type: "application/pdf" };
      const result = canUploadFile(pdfFile, "gpt-5-mini");
      expect(result.allowed).toBe(true);
      expect(result.allowedTypes?.has("application/pdf")).toBe(true);
    });

    it("should reject video upload when using gpt-5-mini (openai format)", () => {
      const videoFile = { name: "video.mp4", type: "video/mp4" };
      const result = canUploadFile(videoFile, "gpt-5-mini");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("not supported by openai");
      expect(result.allowedTypes?.has("video/mp4")).toBe(false);
    });

    it("should allow video upload when using gemini-2.0-flash (google format)", () => {
      const videoFile = { name: "video.mp4", type: "video/mp4" };
      const result = canUploadFile(videoFile, "gemini-2.0-flash");
      expect(result.allowed).toBe(true);
      expect(result.allowedTypes?.has("video/mp4")).toBe(true);
      expect(result.allowedTypes?.has("audio/mp3")).toBe(true);
    });

    it("should allow text/markdown upload for claude-sonnet-4-5 (anthropic format)", () => {
      const markdownFile = { name: "readme.md", type: "text/markdown" };
      const result = canUploadFile(markdownFile, "claude-sonnet-4-5");
      expect(result.allowed).toBe(true);
      expect(result.allowedTypes?.has("text/markdown")).toBe(true);
    });

    it("should reject text/markdown upload for gpt-5-mini (openai format)", () => {
      const markdownFile = { name: "readme.md", type: "text/markdown" };
      const result = canUploadFile(markdownFile, "gpt-5-mini");
      expect(result.allowed).toBe(false);
      expect(result.reason).toContain("text/markdown is not supported");
      expect(result.allowedTypes?.has("text/markdown")).toBe(false);
    });

    it("should handle unknown models gracefully", () => {
      const pdfFile = { name: "document.pdf", type: "application/pdf" };
      const result = canUploadFile(pdfFile, "nonexistent-model");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("Unknown model: nonexistent-model");
      expect(result.allowedTypes).toBeUndefined();
    });

    it("should provide allowedTypes for building file input accept attribute", () => {
      const result = canUploadFile(
        { name: "any.txt", type: "text/plain" },
        "gemini-2.0-flash",
      );
      expect(result.allowedTypes).toBeDefined();
      const acceptAttribute = [...result.allowedTypes!].join(",");
      expect(acceptAttribute).toContain("image/jpeg");
      expect(acceptAttribute).toContain("application/pdf");
      expect(acceptAttribute).toContain("video/mp4");
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

  describe("getSupportedMediaTypes - returns a Set of supported media types", () => {
    it("should return a Set of supported media types for openai format", () => {
      const supported = getSupportedMediaTypes("openai");

      expect(supported).toBeInstanceOf(Set);
      expect(supported.has("application/pdf")).toBe(true);
      expect(supported.has("image/heic")).toBe(false);
      expect(supported.has("image/jpeg")).toBe(true);
      expect(supported.has("text/plain")).toBe(false);
    });

    it("should return a Set of supported media types for google format", () => {
      const supported = getSupportedMediaTypes("google");

      expect(supported.has("application/pdf")).toBe(true);
      expect(supported.has("image/jpeg")).toBe(true);
      expect(supported.has("image/png")).toBe(true);
      expect(supported.has("text/plain")).toBe(true);
      expect(supported.has("audio/mp3")).toBe(true);
      expect(supported.has("video/mp4")).toBe(true);
    });

    it("should return empty Set for js/window formats", () => {
      const jsSupported = getSupportedMediaTypes("js");
      const windowSupported = getSupportedMediaTypes("window");

      expect(jsSupported.size).toBe(0);
      expect(windowSupported.size).toBe(0);
    });

    it("can be used to show users what file types are allowed", () => {
      const format: ModelFormat = "anthropic";
      const supported = getSupportedMediaTypes(format);

      expect(supported.has("application/pdf")).toBe(true);
      expect(supported.has("text/plain")).toBe(true);
      expect(supported.has("application/json")).toBe(true);
      expect(supported.has("video/mp4")).toBe(false);
    });

    it("can be spread into an array for building accept attributes", () => {
      const supported = getSupportedMediaTypes("google");
      const acceptAttribute = [...supported].join(",");

      expect(acceptAttribute).toContain("image/jpeg");
      expect(acceptAttribute).toContain("application/pdf");
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
