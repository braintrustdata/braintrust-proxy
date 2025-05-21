import { describe, test, expect, vi, afterEach } from "vitest";
import { normalizeOpenAIContent } from "./openai";
import { ChatCompletionContentPart } from "openai/resources";
import * as util from "./util";
import * as proxyUtil from "../util";

const mockBase64Data = "AF1231KF==";

describe("normalizeOpenAIContent", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("should pass through string content", async () => {
    const content = "This is a simple string.";
    // The function has a `typeof content === "string"` check,
    // though its signature expects ChatCompletionContentPart.
    const result = await normalizeOpenAIContent(content as any);
    expect(result).toBe(content);
  });

  test("should pass through text content part", async () => {
    const content: ChatCompletionContentPart = {
      type: "text",
      text: "This is text content.",
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(content);
  });

  test("should pass through base64 encoded PNG image (image_url type) directly", async () => {
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAUA" },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(content);
  });

  test("should pass through base64 encoded JPEG image (image_url type) directly", async () => {
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/" },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(content);
  });

  test("should convert base64 encoded PDF (image_url type) to a file block", async () => {
    const pdfDataUrl = "data:application/pdf;base64,JVBERi0xLjQKJ==";
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: pdfDataUrl },
    };
    const expectedOutput = {
      type: "file",
      file: {
        filename: "file_from_base64",
        file_data: pdfDataUrl, // Uses the original data URL
      },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(expectedOutput);
  });

  test("should convert a .pdf file URL (identified by filename) to a file block", async () => {
    const spyConvertMediaToBase64 = vi
      .spyOn(util, "convertMediaToBase64")
      .mockResolvedValue({
        media_type: "application/pdf",
        data: mockBase64Data,
      });
    const fileUrl = "https://example.com/another.pdf";
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: fileUrl },
    };

    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual({
      type: "file",
      file: {
        filename: "another.pdf",
        file_data: `data:application/pdf;base64,${mockBase64Data}`,
      },
    });
    expect(spyConvertMediaToBase64).toHaveBeenCalledWith({
      media: fileUrl,
      allowedMediaTypes: ["application/pdf"],
      maxMediaBytes: 20 * 1024 * 1024,
    });
  });

  test("should convert a PDF file URL (identified by contentType) to a file block", async () => {
    const spyParseFileMetadataFromUrl = vi
      .spyOn(proxyUtil, "parseFileMetadataFromUrl")
      .mockReturnValue({
        filename: "document",
        contentType: "application/pdf",
        url: new URL("https://example.com/document"),
      });
    const spyConvertMediaToBase64 = vi
      .spyOn(util, "convertMediaToBase64")
      .mockResolvedValue({
        media_type: "application/pdf",
        data: mockBase64Data,
      });

    const fileUrl = "https://example.com/document";
    const content: ChatCompletionContentPart = {
      type: "image_url",
      image_url: { url: fileUrl },
    };

    const expectedOutput = {
      type: "file",
      file: {
        filename: "document",
        file_data: `data:application/pdf;base64,${mockBase64Data}`,
      },
    };
    const result = await normalizeOpenAIContent(content);
    expect(result).toEqual(expectedOutput);
    expect(spyConvertMediaToBase64).toHaveBeenCalledWith({
      media: fileUrl,
      allowedMediaTypes: ["application/pdf"],
      maxMediaBytes: 20 * 1024 * 1024,
    });
  });
});
