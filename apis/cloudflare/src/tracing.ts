import {
  ORG_NAME_HEADER,
  SpanLogger,
  parseAuthHeader,
} from "@braintrust/proxy";
import { BraintrustState, loginToState, Span } from "braintrust";
import { base64ToArrayBuffer } from "@braintrust/proxy/utils";
import {
  digestMessage,
  encryptedGet,
  encryptedPut,
  type Cache as EdgeCache,
} from "@braintrust/proxy/edge";
import { AttachmentReference } from "@braintrust/core/typespecs";
import { replacePayloadWithAttachments } from "./attachment-wrapper";

export function makeProxySpanLogger(
  span: Span,
  attachments: Record<string, AttachmentReference>,
  waitUntil: (promise: Promise<any>) => void,
): SpanLogger {
  return {
    log: (args) => {
      span.log(replacePayloadWithAttachments(args, span.state(), attachments));
      waitUntil(span.flush());
    },
    end: span.end.bind(span),
    setName(name) {
      span.setAttributes({ name });
    },
    reportProgress() {
      return;
    },
  };
}

const base64ImagePattern =
  /^data:image\/[a-zA-Z]+;base64,[A-Za-z0-9+/]+={0,2}$/;
export function isBase64Image(s: string): boolean {
  // Avoid unnecessary (slower) pattern matching
  if (!s.startsWith("data:")) {
    return false;
  }

  return base64ImagePattern.test(s);
}
// Being as specific as possible about allowable characters and avoiding greedy matching
// helps avoid catastrophic backtracking: https://github.com/braintrustdata/braintrust/pull/4831
const base64ContentTypePattern =
  /^data:([a-zA-Z0-9]+\/[a-zA-Z0-9+.-]+);base64,/;
export function getBase64Parts(s: string): {
  mimeType: string;
  data: ArrayBuffer;
} {
  const parts = s.match(base64ContentTypePattern);
  if (!parts) {
    throw new Error("Invalid base64 image");
  }
  const mimeType = parts[1];
  const data = s.slice(`data:${mimeType};base64,`.length);
  return { mimeType, data: base64ToArrayBuffer(data) };
}

export async function cachedLogin({
  appUrl,
  headers,
  cache,
}: {
  headers: Headers;
  appUrl: string;
  cache: EdgeCache;
}) {
  const orgName = headers.get(ORG_NAME_HEADER) ?? undefined;
  const token =
    parseAuthHeader({
      authorization: headers.get("authorization") ?? undefined,
    }) ?? undefined;

  const encryptionKey = await digestMessage(
    JSON.stringify({ token: token ?? "anon", orgName }),
  );

  let state: BraintrustState;
  const stateResp = await encryptedGet(cache, encryptionKey, encryptionKey);
  if (stateResp) {
    state = BraintrustState.deserialize(JSON.parse(stateResp), {
      noExitFlush: true,
    });
  } else {
    state = await loginToState({
      apiKey:
        parseAuthHeader({
          authorization: headers.get("authorization") ?? undefined,
        }) ?? undefined,
      // If the app URL is explicitly set to an env var, it's meant to override
      // the origin.
      appUrl: appUrl,
      orgName,
      noExitFlush: true,
    });

    encryptedPut(
      cache,
      encryptionKey,
      encryptionKey,
      JSON.stringify(state.serialize()),
      {
        ttl: 60,
      },
    ).catch((e) => {
      console.error("Error while caching login credentials", e);
    });
  }

  return state;
}
