import { describe, expect, it } from "vitest";
import { pipeBodyToResponse } from "./proxy";

describe("pipeBodyToResponse", () => {
  it("resolves after the readable stream finishes piping", async () => {
    const encoder = new TextEncoder();
    const chunks: string[] = [];
    let closed = false;
    let finishedWriting = false;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("first"));
        await new Promise((resolve) => setTimeout(resolve, 20));
        controller.enqueue(encoder.encode("-second"));
        finishedWriting = true;
        controller.close();
      },
    });

    const responsePromise = pipeBodyToResponse(
      stream,
      new WritableStream<Uint8Array>({
        write(chunk) {
          chunks.push(new TextDecoder().decode(chunk));
        },
        close() {
          closed = true;
        },
      }),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(finishedWriting).toBe(false);
    expect(closed).toBe(false);

    await responsePromise;

    expect(finishedWriting).toBe(true);
    expect(closed).toBe(true);
    expect(chunks.join("")).toBe("first-second");
  });
});
