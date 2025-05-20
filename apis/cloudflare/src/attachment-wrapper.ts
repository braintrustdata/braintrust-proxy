import { isArray, isObject } from "@braintrust/core";
import {
  AttachmentReference,
  braintrustAttachmentReferenceSchema,
} from "@braintrust/core/typespecs";
import { getBase64Parts, isBase64File } from "@braintrust/local/functions";
import {
  Attachment,
  BraintrustState,
  deserializePlainStringAsJSON,
  ReadonlyAttachment,
} from "braintrust";

// This is a hack that makes it easy on the typesystem to deal with the payload which
// doesn't change types.
export function replacePayloadWithAttachments<T>(
  data: T,
  state: BraintrustState | undefined,
  attachments: Record<string, AttachmentReference>,
): T {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return replacePayloadWithAttachmentsInner(data, state, attachments) as T;
}

function replacePayloadWithAttachmentsInner(
  data: unknown,
  state: BraintrustState | undefined,
  attachments: Record<string, AttachmentReference>,
): unknown {
  if (isArray(data)) {
    return data.map((item) =>
      replacePayloadWithAttachmentsInner(item, state, attachments),
    );
  } else if (isObject(data)) {
    return Object.fromEntries(
      Object.entries(data).map(([key, value]) => [
        key,
        replacePayloadWithAttachmentsInner(value, state, attachments),
      ]),
    );
  } else if (typeof data === "string") {
    if (attachments[data]) {
      return attachments[data];
    } else if (
      isBase64File(
        data,
        (mimeType) =>
          mimeType.startsWith("image/") || mimeType === "application/pdf",
      )
    ) {
      const { mimeType, data: arrayBuffer } = getBase64Parts(data);
      const filename = `file.${mimeType.split("/")[1]}`;
      return new Attachment({
        data: arrayBuffer,
        contentType: mimeType,
        filename,
        state,
      });
    } else {
      return data;
    }
  } else {
    return data;
  }
}

export function replaceAttachmentsInPayload<T>(
  data: T,
  state: BraintrustState | undefined,
  attachments: Record<string, AttachmentReference>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
  return replaceAttachmentsInPayloadInner(
    data,
    state,
    attachments,
  ) as Promise<T>;
}

async function replaceAttachmentsInPayloadInner(
  payload: unknown,
  state: BraintrustState | undefined,
  attachments: Record<string, AttachmentReference>,
): Promise<unknown> {
  if (isArray(payload)) {
    return Promise.all(
      payload.map((item) =>
        replaceAttachmentsInPayloadInner(item, state, attachments),
      ),
    );
  } else if (payload instanceof ReadonlyAttachment) {
    const ret = await replaceAttachmentReferenceObjectWithDownloadUrl(payload);
    if (ret) {
      attachments[ret] = payload.reference;
    }
    return ret;
  } else if (isObject(payload)) {
    const replaced = await replaceAttachmentReferenceWithDownloadUrl(
      payload,
      state,
      attachments,
    );
    if (replaced) {
      return replaced;
    }

    return Object.fromEntries(
      await Promise.all(
        Object.entries(payload).map(async ([key, value]) => [
          key,
          await replaceAttachmentsInPayloadInner(value, state, attachments),
        ]),
      ),
    );
  } else if (typeof payload === "string") {
    const deserialized = deserializePlainStringAsJSON(payload).value;
    return (
      (await replaceAttachmentReferenceWithDownloadUrl(
        deserialized,
        state,
        attachments,
      )) ?? payload
    );
  }

  return payload;
}

async function replaceAttachmentReferenceWithDownloadUrl(
  payload: unknown,
  state: BraintrustState | undefined,
  attachments: Record<string, AttachmentReference>,
): Promise<string | undefined> {
  const attachmentReference =
    braintrustAttachmentReferenceSchema.safeParse(payload);
  if (!attachmentReference.success) {
    return undefined;
  }
  const attachment = new ReadonlyAttachment(attachmentReference.data, state);
  const ret = await replaceAttachmentReferenceObjectWithDownloadUrl(attachment);
  if (ret) {
    attachments[ret] = attachmentReference.data;
  }
  return ret;
}

async function replaceAttachmentReferenceObjectWithDownloadUrl(
  attachment: ReadonlyAttachment,
): Promise<string | undefined> {
  const { downloadUrl, status } = await attachment.metadata();
  switch (status.upload_status) {
    case "error": {
      throw new Error(`Attachment failed to upload: ${status.error_message}`);
    }
    case "done": {
      return downloadUrl;
    }
    case "uploading": {
      throw new Error(`Attachment not ready`);
    }
    default: {
      throw new Error(`Unknown attachment status: ${status.upload_status}`);
    }
  }
}
