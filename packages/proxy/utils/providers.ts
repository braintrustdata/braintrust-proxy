import { ModelSpec, VertexMetadataSchema } from "@schema";
import { importPKCS8, SignJWT } from "jose";
import { z } from "zod";

export function formatVertexEndpoint({
  project,
  apiBase: apiBaseProp,
  modelSpec,
  defaultLocation,
}: {
  project: string;
  apiBase?: string | null;
  modelSpec: ModelSpec | null;
  defaultLocation: string;
}) {
  const locations = modelSpec?.locations?.length
    ? modelSpec.locations
    : [defaultLocation];
  const location = locations[Math.floor(Math.random() * locations.length)];
  const urlBase =
    apiBaseProp || `https://${location}-aiplatform.googleapis.com`;
  return {
    apiBase: `${urlBase}/v1/projects/${project}/locations/${location}`,
    location,
  };
}

export async function getVertexAccessToken({
  secret,
  authType,
}: {
  secret: string;
  authType: z.infer<typeof VertexMetadataSchema.shape.authType>;
}): Promise<string> {
  const accessToken =
    authType === "access_token" ? secret : await getGoogleAccessToken(secret);
  if (!accessToken) {
    throw new Error("Failed to get Google access token");
  }
  return accessToken;
}

async function getGoogleAccessToken(secret: string): Promise<string> {
  const {
    private_key_id: kid,
    private_key: pk,
    client_email: email,
    token_uri: tokenUri,
  } = z
    .object({
      type: z.literal("service_account"),
      private_key_id: z.string(),
      private_key: z.string(),
      client_email: z.string(),
      token_uri: z.string(),
    })
    .parse(JSON.parse(secret));
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/cloud-platform",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid })
    .setIssuer(email)
    .setAudience(tokenUri)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(await importPKCS8(pk, "RS256"));
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  return z
    .object({
      access_token: z.string(),
      token_type: z.literal("Bearer"),
    })
    .parse(await res.json()).access_token;
}
