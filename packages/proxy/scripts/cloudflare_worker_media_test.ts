import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const mediaUrl =
  process.env.CLOUDFLARE_REMOTE_MEDIA_TEST_URL ??
  "https://httpbin.org/image/png";
const privateMediaUrl = "https://169.254.169.254/latest/meta-data";
const compatibilityDate = "2025-08-15";
const maxOutputLength = 20_000;

interface WranglerProcess {
  process: ChildProcessWithoutNullStreams;
  output: () => string;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringProperty(value: unknown, key: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const property = value[key];
  return typeof property === "string" ? property : undefined;
}

function nestedStringProperty(
  value: unknown,
  key: string,
  nestedKey: string,
): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  return stringProperty(value[key], nestedKey);
}

function truncateOutput(output: string): string {
  if (output.length <= maxOutputLength) {
    return output;
  }
  return output.slice(output.length - maxOutputLength);
}

function workerSource(utilPath: string): string {
  return `import { convertMediaToBase64 } from ${JSON.stringify(utilPath)};

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message };
  }
  return { name: typeof error, message: String(error) };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({ ok: true, userAgent: navigator.userAgent });
    }

    if (url.pathname !== "/convert") {
      return json({ ok: false, error: "unknown path" }, 404);
    }

    const media = url.searchParams.get("url") ?? ${JSON.stringify(mediaUrl)};
    try {
      const result = await convertMediaToBase64({
        media,
        allowedMediaTypes: null,
        maxMediaBytes: 1024 * 1024,
      });
      return json({
        ok: true,
        userAgent: navigator.userAgent,
        media_type: result.media_type,
        data_prefix: result.data.slice(0, 16),
        data_length: result.data.length,
      });
    } catch (error) {
      return json(
        { ok: false, userAgent: navigator.userAgent, error: serializeError(error) },
        500,
      );
    }
  },
};
`;
}

async function writeWorkerProject({
  accountId,
  proxyPackageRoot,
  tempDir,
  workerName,
}: {
  accountId: string;
  proxyPackageRoot: string;
  tempDir: string;
  workerName: string;
}) {
  await mkdir(join(tempDir, "src"), { recursive: true });
  await mkdir(join(tempDir, "home"), { recursive: true });
  await mkdir(join(tempDir, "xdg-config"), { recursive: true });

  await writeFile(
    join(tempDir, "wrangler.toml"),
    `name = ${JSON.stringify(workerName)}
main = "src/index.ts"
compatibility_date = ${JSON.stringify(compatibilityDate)}
compatibility_flags = ["nodejs_compat"]
account_id = ${JSON.stringify(accountId)}
`,
  );
  await writeFile(
    join(tempDir, "src/index.ts"),
    workerSource(join(proxyPackageRoot, "src/providers/util.ts")),
  );
}

function startWrangler({
  cloudflarePackageRoot,
  port,
  proxyPackageRoot,
  tempDir,
}: {
  cloudflarePackageRoot: string;
  port: number;
  proxyPackageRoot: string;
  tempDir: string;
}): WranglerProcess {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(
    command,
    [
      "--dir",
      cloudflarePackageRoot,
      "exec",
      "wrangler",
      "dev",
      "--remote",
      "--config",
      join(tempDir, "wrangler.toml"),
      "--cwd",
      tempDir,
      "--tsconfig",
      join(proxyPackageRoot, "tsconfig.json"),
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
      "--log-level",
      "error",
      "--show-interactive-dev-session=false",
    ],
    {
      env: {
        ...process.env,
        HOME: join(tempDir, "home"),
        XDG_CONFIG_HOME: join(tempDir, "xdg-config"),
      },
    },
  );

  let output = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });

  return {
    process: child,
    output: () => truncateOutput(output),
  };
}

async function stopWrangler(child: ChildProcessWithoutNullStreams) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  child.kill("SIGTERM");
  await new Promise<void>((resolvePromise) => {
    const timeout = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolvePromise();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
  });
}

async function fetchJson(
  url: string,
): Promise<{ body: unknown; status: number }> {
  const response = await fetch(url);
  const text = await response.text();
  const body: unknown = JSON.parse(text);
  return { body, status: response.status };
}

async function waitForWorker(baseUrl: string, wrangler: WranglerProcess) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120_000) {
    if (
      wrangler.process.exitCode !== null ||
      wrangler.process.signalCode !== null
    ) {
      throw new Error(`Wrangler exited before startup:\n${wrangler.output()}`);
    }

    try {
      const { body, status } = await fetchJson(`${baseUrl}/health`);
      if (
        status === 200 &&
        isRecord(body) &&
        body.ok === true &&
        body.userAgent === "Cloudflare-Workers"
      ) {
        return;
      }
    } catch {
      // Retry until Wrangler finishes uploading the remote development Worker.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }

  throw new Error(
    `Timed out waiting for Wrangler remote Worker:\n${wrangler.output()}`,
  );
}

function expectSuccessfulMediaResponse(body: unknown) {
  if (!isRecord(body) || body.ok !== true) {
    throw new Error(
      `Expected successful media response, got ${JSON.stringify(body)}`,
    );
  }

  if (body.userAgent !== "Cloudflare-Workers") {
    throw new Error(
      `Expected Cloudflare Worker runtime, got ${JSON.stringify(body)}`,
    );
  }

  const mediaType = stringProperty(body, "media_type");
  if (!mediaType || !mediaType.startsWith("image/")) {
    throw new Error(`Expected image media type, got ${JSON.stringify(body)}`);
  }

  const dataPrefix = stringProperty(body, "data_prefix");
  if (!dataPrefix) {
    throw new Error(`Expected base64 data prefix, got ${JSON.stringify(body)}`);
  }

  const dataLength = isRecord(body) ? body.data_length : undefined;
  if (typeof dataLength !== "number" || dataLength <= dataPrefix.length) {
    throw new Error(
      `Expected non-empty base64 payload, got ${JSON.stringify(body)}`,
    );
  }
}

function expectBlockedPrivateResponse(body: unknown, status: number) {
  if (status !== 500) {
    throw new Error(`Expected private media request to fail, got ${status}`);
  }

  const message = nestedStringProperty(body, "error", "message");
  if (message !== "Media URL resolves to a blocked address") {
    throw new Error(
      `Expected private media rejection, got ${JSON.stringify(body)}`,
    );
  }
}

async function main() {
  requireEnv("CLOUDFLARE_API_TOKEN");
  const accountId = requireEnv("CLOUDFLARE_ACCOUNT_ID");

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const proxyPackageRoot = resolve(scriptDir, "..");
  const proxyRepoRoot = resolve(proxyPackageRoot, "../..");
  const cloudflarePackageRoot = join(proxyRepoRoot, "apis/cloudflare");
  const tempDir = await mkdtemp(join(tmpdir(), "bt-proxy-cloudflare-media-"));
  const workerName = `bt-proxy-media-ci-${Date.now().toString(36)}-${process.pid.toString(36)}`;
  const port = 18_000 + Math.floor(Math.random() * 1_000);
  let wrangler: WranglerProcess | undefined;

  try {
    await writeWorkerProject({
      accountId,
      proxyPackageRoot,
      tempDir,
      workerName,
    });
    wrangler = startWrangler({
      cloudflarePackageRoot,
      port,
      proxyPackageRoot,
      tempDir,
    });

    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForWorker(baseUrl, wrangler);

    const mediaResponse = await fetchJson(
      `${baseUrl}/convert?url=${encodeURIComponent(mediaUrl)}`,
    );
    expectSuccessfulMediaResponse(mediaResponse.body);

    const privateResponse = await fetchJson(
      `${baseUrl}/convert?url=${encodeURIComponent(privateMediaUrl)}`,
    );
    expectBlockedPrivateResponse(privateResponse.body, privateResponse.status);

    console.log(
      `Cloudflare remote Worker media test passed for ${mediaUrl} and private literal rejection`,
    );
  } catch (error) {
    if (wrangler) {
      console.error(wrangler.output());
    }
    throw error;
  } finally {
    if (wrangler) {
      await stopWrangler(wrangler.process);
    }
    await rm(tempDir, { force: true, recursive: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
