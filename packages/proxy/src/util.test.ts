import { describe, expect, test } from "vitest";
import { parseFilenameFromUrl } from "./util";

describe("parseFilenameFromUrl", () => {
  test("handles basic URLs", () => {
    expect(parseFilenameFromUrl("https://example.com/file.pdf")).toBe(
      "file.pdf",
    );
    expect(parseFilenameFromUrl("http://foo.com/bar/example.pdf")).toBe(
      "example.pdf",
    );
    expect(parseFilenameFromUrl("gs://bucket/file.pdf")).toBe("file.pdf");
  });

  test("handles URLs with query parameters", () => {
    expect(
      parseFilenameFromUrl("https://example.com/file.pdf?query=value"),
    ).toBe("file.pdf");
    expect(parseFilenameFromUrl("http://foo.com/doc.pdf?v=1&id=123")).toBe(
      "doc.pdf",
    );
    expect(
      parseFilenameFromUrl("https://site.com/download.pdf?token=abc123"),
    ).toBe("download.pdf");
    expect(
      parseFilenameFromUrl(
        "http://example.com/report.pdf?token=example%20with%20spaces",
      ),
    ).toBe("report.pdf");
  });

  test("handles filenames with spaces and special characters", () => {
    expect(parseFilenameFromUrl("https://example.com/my%20file.pdf")).toBe(
      "my file.pdf",
    );
    expect(parseFilenameFromUrl("http://foo.com/report-2023.pdf")).toBe(
      "report-2023.pdf",
    );
    expect(parseFilenameFromUrl("https://site.com/exa%20mple.pdf")).toBe(
      "exa mple.pdf",
    );
    expect(
      parseFilenameFromUrl("http://example.com/file%20with%20spaces.pdf"),
    ).toBe("file with spaces.pdf");
    expect(
      parseFilenameFromUrl(
        "https://example.com/file-name_with.special-chars.pdf",
      ),
    ).toBe("file-name_with.special-chars.pdf");
    expect(
      parseFilenameFromUrl("http://site.org/file%25with%25percent.pdf"),
    ).toBe("file%with%percent.pdf");
    expect(parseFilenameFromUrl("https://example.com/file+with+plus.pdf")).toBe(
      "file+with+plus.pdf",
    );
  });

  test("handles pathless URLs", () => {
    expect(parseFilenameFromUrl("https://example.pdf")).toBe("example.pdf");
    expect(parseFilenameFromUrl("file.pdf")).toBe("file.pdf");
    expect(parseFilenameFromUrl("folder/file.pdf")).toBe("file.pdf");
  });

  test("handles URLs with fragments", () => {
    expect(
      parseFilenameFromUrl("https://example.com/document.pdf#page=1"),
    ).toBe("document.pdf");
    expect(parseFilenameFromUrl("http://site.com/resume.pdf#section")).toBe(
      "resume.pdf",
    );
    expect(
      parseFilenameFromUrl("https://example.com/file.pdf#fragment=with=equals"),
    ).toBe("file.pdf");
  });

  test("handles URLs with both query parameters and fragments", () => {
    expect(
      parseFilenameFromUrl("https://example.com/report.pdf?version=2#page=5"),
    ).toBe("report.pdf");
    expect(
      parseFilenameFromUrl(
        "http://site.org/document.pdf?dl=true#section=summary",
      ),
    ).toBe("document.pdf");
    expect(
      parseFilenameFromUrl("https://example.com/file.pdf?a=1&b=2#c=3&d=4"),
    ).toBe("file.pdf");
  });

  test("handles non-standard URL formats", () => {
    expect(
      parseFilenameFromUrl("http://foo.com/bar/?file=example.pdf"),
    ).toBeUndefined();
    expect(parseFilenameFromUrl("ftp://files.org/documents/sample.pdf")).toBe(
      "sample.pdf",
    );
    expect(parseFilenameFromUrl("s3://my-bucket/backup/archive.pdf")).toBe(
      "archive.pdf",
    );
    expect(
      parseFilenameFromUrl("file:///C:/Users/name/Documents/file.pdf"),
    ).toBe("file.pdf");
    expect(
      parseFilenameFromUrl(
        "sftp://username:password@server.com/path/to/file.pdf",
      ),
    ).toBe("file.pdf");
  });

  test("returns undefined for URLs without filename", () => {
    expect(parseFilenameFromUrl("https://example.com/")).toBeUndefined();
    expect(parseFilenameFromUrl("http://site.org")).toBeUndefined();
    expect(parseFilenameFromUrl("")).toBeUndefined();
    expect(parseFilenameFromUrl("   ")).toBeUndefined();
    expect(parseFilenameFromUrl(null as unknown as string)).toBeUndefined();
    expect(
      parseFilenameFromUrl(undefined as unknown as string),
    ).toBeUndefined();
  });

  test("handles different file extensions", () => {
    expect(parseFilenameFromUrl("https://example.com/document.docx")).toBe(
      "document.docx",
    );
    expect(parseFilenameFromUrl("https://example.com/spreadsheet.xlsx")).toBe(
      "spreadsheet.xlsx",
    );
    expect(parseFilenameFromUrl("https://example.com/presentation.pptx")).toBe(
      "presentation.pptx",
    );
    expect(parseFilenameFromUrl("https://example.com/archive.zip")).toBe(
      "archive.zip",
    );
    expect(parseFilenameFromUrl("https://example.com/image.jpg")).toBe(
      "image.jpg",
    );
    expect(parseFilenameFromUrl("https://example.com/video.mp4")).toBe(
      "video.mp4",
    );
    expect(parseFilenameFromUrl("https://example.com/data.json")).toBe(
      "data.json",
    );
    expect(parseFilenameFromUrl("https://example.com/page.html")).toBe(
      "page.html",
    );
  });

  test("handles complex URL encodings", () => {
    expect(
      parseFilenameFromUrl(
        "https://example.com/file%20with%20spaces%20and%20%23%20symbols.pdf",
      ),
    ).toBe("file with spaces and # symbols.pdf");
    expect(
      parseFilenameFromUrl("https://example.com/%E6%96%87%E4%BB%B6.pdf"),
    ).toBe("文件.pdf");
    expect(
      parseFilenameFromUrl("https://example.com/r%C3%A9sum%C3%A9.pdf"),
    ).toBe("résumé.pdf");
    expect(
      parseFilenameFromUrl("https://example.com/file%2Bwith%2Bplus.pdf"),
    ).toBe("file+with+plus.pdf");
    expect(
      parseFilenameFromUrl("https://example.com/file%3Fwith%3Fquestion.pdf"),
    ).toBe("file?with?question.pdf");
  });
});
