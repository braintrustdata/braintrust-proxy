import { describe, expect, test } from "vitest";
import { parseFileMetadataFromUrl, _urljoin } from "./util";

describe("parseFileMetadataFromUrl", () => {
  test("handles basic URLs", () => {
    expect(parseFileMetadataFromUrl("https://example.com/file.pdf")).toEqual({
      filename: "file.pdf",
      url: expect.any(URL),
    });
    expect(parseFileMetadataFromUrl("http://foo.com/bar/example.pdf")).toEqual({
      filename: "example.pdf",
      url: expect.any(URL),
    });
  });

  test("handles URLs with query parameters", () => {
    expect(
      parseFileMetadataFromUrl("https://example.com/file.pdf?query=value"),
    ).toEqual({ filename: "file.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("http://foo.com/doc.pdf?v=1&id=123"),
    ).toEqual({ filename: "doc.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://site.com/download.pdf?token=abc123"),
    ).toEqual({ filename: "download.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl(
        "http://example.com/report.pdf?token=example%20with%20spaces",
      ),
    ).toEqual({ filename: "report.pdf", url: expect.any(URL) });
  });

  test("handles filenames with spaces and special characters", () => {
    expect(
      parseFileMetadataFromUrl("https://example.com/my%20file.pdf"),
    ).toEqual({ filename: "my file.pdf", url: expect.any(URL) });
    expect(parseFileMetadataFromUrl("http://foo.com/report-2023.pdf")).toEqual({
      filename: "report-2023.pdf",
      url: expect.any(URL),
    });
    expect(parseFileMetadataFromUrl("https://site.com/exa%20mple.pdf")).toEqual(
      { filename: "exa mple.pdf", url: expect.any(URL) },
    );
    expect(
      parseFileMetadataFromUrl("http://example.com/file%20with%20spaces.pdf"),
    ).toEqual({ filename: "file with spaces.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl(
        "https://example.com/file-name_with.special-chars.pdf",
      ),
    ).toEqual({
      filename: "file-name_with.special-chars.pdf",
      url: expect.any(URL),
    });
    expect(
      parseFileMetadataFromUrl("http://site.org/file%25with%25percent.pdf"),
    ).toEqual({ filename: "file%with%percent.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://example.com/file+with+plus.pdf"),
    ).toEqual({ filename: "file+with+plus.pdf", url: expect.any(URL) });
  });

  test("handles pathless URLs", () => {
    expect(parseFileMetadataFromUrl("https://example.pdf")).toBeUndefined();
    expect(parseFileMetadataFromUrl("file.pdf")).toBeUndefined();
    expect(parseFileMetadataFromUrl("folder/file.pdf")).toBeUndefined();
  });

  test("handles URLs with fragments", () => {
    expect(
      parseFileMetadataFromUrl("https://example.com/document.pdf#page=1"),
    ).toEqual({ filename: "document.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("http://site.com/resume.pdf#section"),
    ).toEqual({ filename: "resume.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl(
        "https://example.com/file.pdf#fragment=with=equals",
      ),
    ).toEqual({ filename: "file.pdf", url: expect.any(URL) });
  });

  test("handles URLs with both query parameters and fragments", () => {
    expect(
      parseFileMetadataFromUrl(
        "https://example.com/report.pdf?version=2#page=5",
      ),
    ).toEqual({ filename: "report.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl(
        "http://site.org/document.pdf?dl=true#section=summary",
      ),
    ).toEqual({ filename: "document.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://example.com/file.pdf?a=1&b=2#c=3&d=4"),
    ).toEqual({ filename: "file.pdf", url: expect.any(URL) });
  });

  test("returns undefined for URLs with uninferrable file names", () => {
    expect(
      parseFileMetadataFromUrl("http://foo.com/bar/?file=example.pdf"),
    ).toBeUndefined();
    expect(parseFileMetadataFromUrl("http://foo.com/bar/")).toBeUndefined();
    expect(parseFileMetadataFromUrl("http://foo.com")).toBeUndefined();
  });

  test("returns undefined for non-standard URL formats", () => {
    expect(
      parseFileMetadataFromUrl("http://foo.com/bar/?file=example.pdf"),
    ).toBeUndefined();
    expect(parseFileMetadataFromUrl("gs://bucket/file.pdf")).toBeUndefined();
    expect(
      parseFileMetadataFromUrl("ftp://files.org/documents/sample.pdf"),
    ).toBeUndefined();
    expect(
      parseFileMetadataFromUrl("s3://my-bucket/backup/archive.pdf"),
    ).toBeUndefined();
    expect(
      parseFileMetadataFromUrl("file:///C:/Users/name/Documents/file.pdf"),
    ).toBeUndefined();
    expect(
      parseFileMetadataFromUrl(
        "sftp://username:password@server.com/path/to/file.pdf",
      ),
    ).toBeUndefined();
  });

  test("returns undefined for URLs without filename", () => {
    expect(parseFileMetadataFromUrl("https://example.com/")).toBeUndefined();
    expect(parseFileMetadataFromUrl("http://site.org")).toBeUndefined();
    expect(parseFileMetadataFromUrl("")).toBeUndefined();
    expect(parseFileMetadataFromUrl("   ")).toBeUndefined();
    expect(parseFileMetadataFromUrl(null as unknown as string)).toBeUndefined();
    expect(
      parseFileMetadataFromUrl(undefined as unknown as string),
    ).toBeUndefined();
  });

  test("handles different file extensions", () => {
    expect(
      parseFileMetadataFromUrl("https://example.com/document.docx"),
    ).toEqual({ filename: "document.docx", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://example.com/spreadsheet.xlsx"),
    ).toEqual({ filename: "spreadsheet.xlsx", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://example.com/presentation.pptx"),
    ).toEqual({ filename: "presentation.pptx", url: expect.any(URL) });
    expect(parseFileMetadataFromUrl("https://example.com/archive.zip")).toEqual(
      { filename: "archive.zip", url: expect.any(URL) },
    );
    expect(parseFileMetadataFromUrl("https://example.com/image.jpg")).toEqual({
      filename: "image.jpg",
      url: expect.any(URL),
    });
    expect(parseFileMetadataFromUrl("https://example.com/video.mp4")).toEqual({
      filename: "video.mp4",
      url: expect.any(URL),
    });
    expect(parseFileMetadataFromUrl("https://example.com/data.json")).toEqual({
      filename: "data.json",
      url: expect.any(URL),
    });
    expect(parseFileMetadataFromUrl("https://example.com/page.html")).toEqual({
      filename: "page.html",
      url: expect.any(URL),
    });
  });

  test("handles complex URL encodings", () => {
    expect(
      parseFileMetadataFromUrl(
        "https://example.com/file%20with%20spaces%20and%20%23%20symbols.pdf",
      ),
    ).toEqual({
      filename: "file with spaces and # symbols.pdf",
      url: expect.any(URL),
    });
    expect(
      parseFileMetadataFromUrl("https://example.com/%E6%96%87%E4%BB%B6.pdf"),
    ).toEqual({ filename: "文件.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://example.com/r%C3%A9sum%C3%A9.pdf"),
    ).toEqual({ filename: "résumé.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl("https://example.com/file%2Bwith%2Bplus.pdf"),
    ).toEqual({ filename: "file+with+plus.pdf", url: expect.any(URL) });
    expect(
      parseFileMetadataFromUrl(
        "https://example.com/file%3Fwith%3Fquestion.pdf",
      ),
    ).toEqual({ filename: "file?with?question.pdf", url: expect.any(URL) });
  });

  test("handles S3 pre-signed URLs", () => {
    expect(
      parseFileMetadataFromUrl(
        "https://somes3subdomain.s3.amazonaws.com/files/e1ebccc2-4006-434e-a739-cba3b3fd85dd?X-Amz-Expires=86400&response-content-disposition=attachment%3B%20filename%3D%22test.pdf%22&response-content-type=application%2Fpdf&x-id=GetObject",
      ),
    ).toEqual({
      filename: "test.pdf",
      contentType: "application/pdf",
      url: expect.any(URL),
    });
  });
});

test("_urljoin", () => {
  expect(_urljoin("/a", "/b", "/c")).toBe("a/b/c");
  expect(_urljoin("a", "b", "c")).toBe("a/b/c");
  expect(_urljoin("/a/", "/b/", "/c/")).toBe("a/b/c/");
  expect(_urljoin("a/", "b/", "c/")).toBe("a/b/c/");
  expect(_urljoin("", "a", "b", "c")).toBe("a/b/c");
  expect(_urljoin("a", "", "c")).toBe("a/c");
  expect(_urljoin("/", "a", "b", "c")).toBe("a/b/c");
  expect(_urljoin("http://example.com", "api", "v1")).toBe(
    "http://example.com/api/v1",
  );
  expect(_urljoin("http://example.com/", "/api/", "/v1/")).toBe(
    "http://example.com/api/v1/",
  );
  expect(_urljoin()).toBe("");
  expect(_urljoin("a")).toBe("a");
});
