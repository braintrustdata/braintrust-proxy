import { fileURLToPath } from "node:url";
import {
  generateZodClientFromOpenAPI,
  getHandlebars,
} from "openapi-zod-client";
import * as fs from "fs/promises";
import path from "node:path";
import * as ts from "typescript";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const OPENAPI_SPEC_PATH = path.join(SCRIPT_DIR, "../generated_types.json");
const TEMPLATE_PATH = path.join(
  SCRIPT_DIR,
  "./openapi_zod_client_output_template.hbs",
);
const OUTPUT_PATH = path.join(SCRIPT_DIR, "../src/generated_types.ts");

async function main() {
  const openApiDoc = JSON.parse(await fs.readFile(OPENAPI_SPEC_PATH, "utf-8"));
  const handlebars = getHandlebars();
  // only outputs as zod v3, support for v4 still in progress.
  await generateZodClientFromOpenAPI({
    openApiDoc,
    templatePath: TEMPLATE_PATH,
    distPath: OUTPUT_PATH,
    handlebars,
    options: {
      shouldExportAllSchemas: true,
      shouldExportAllTypes: true,
      additionalPropertiesDefaultValue: false,
    },
  });
  // Read generated code. Optionally skip post-processing when debugging raw output.
  let code = await fs.readFile(OUTPUT_PATH, "utf8");

  // If SKIP_CODMOD=1 is set in the environment, write the generated file as-is
  // (with the generated banner) and exit. Useful to inspect upstream generator output
  // before applying our v3->v4 codemod.
  if (process.env.SKIP_CODMOD === "1") {
    const internalGitSha = openApiDoc.info["x-internal-git-sha"] || "UNKNOWN";
    const banner = `// Auto-generated file (internal git SHA ${internalGitSha}) -- do not modify\n\n`;
    await fs.writeFile(OUTPUT_PATH, banner + code);
    return;
  }

  const fixGenerated = (s: string) => {
    // Robust AST transform using TypeScript Transformer API. This reliably
    // rewrites single-arg `z.record(valueSchema)` into `z.record(z.string(), valueSchema)`
    // and unwraps parenthesized expressions. If anything goes wrong, fall back to the cleaned string.
    try {
      const sf = ts.createSourceFile(
        "generated_types.ts",
        s,
        ts.ScriptTarget.Latest,
        /*setParentNodes*/ true,
        ts.ScriptKind.TS,
      );

      const isZCall = (expr: ts.Expression, name: string) =>
        ts.isPropertyAccessExpression(expr) &&
        ts.isIdentifier(expr.expression) &&
        expr.expression.text === "z" &&
        expr.name.text === name;

      const makeZCallExpr = (name: string) =>
        ts.factory.createCallExpression(
          ts.factory.createPropertyAccessExpression(
            ts.factory.createIdentifier("z"),
            name,
          ),
          undefined,
          [],
        );

      const transformer: ts.TransformerFactory<ts.SourceFile> = (context) => {
        const visit: ts.Visitor = (node) => {
          if (ts.isCallExpression(node)) {
            const expr = node.expression;

            // Handle z.record(...) general case
            if (isZCall(expr, "record")) {
              const args = node.arguments.slice();
              if (args.length === 1) {
                // single-arg -> insert z.string() as key schema
                const valueArg = ts.isParenthesizedExpression(args[0])
                  ? args[0].expression
                  : args[0];
                return ts.factory.updateCallExpression(
                  node,
                  node.expression,
                  node.typeArguments,
                  [makeZCallExpr("string"), valueArg],
                );
              }

              // If call already has 2+ args, just unwrap parentheses on second arg
              if (args.length >= 2) {
                const second = args[1];
                const newSecond = ts.isParenthesizedExpression(second)
                  ? second.expression
                  : second;
                const newArgs = [args[0], newSecond, ...args.slice(2)];
                return ts.factory.updateCallExpression(
                  node,
                  node.expression,
                  node.typeArguments,
                  newArgs,
                );
              }
            }
          }
          return ts.visitEachChild(node, visit, context);
        };
        return (node) => ts.visitNode(node, visit) as ts.SourceFile;
      };

      const result = ts.transform(sf, [transformer]);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- Transformer API returns Node[]; we expect a SourceFile here
      const transformed = result.transformed[0] as ts.SourceFile;
      const printer = ts.createPrinter({ removeComments: false });
      const printed = printer.printFile(transformed);
      result.dispose();
      return printed;
    } catch {
      return s;
    }
  };

  // Token-level repair: balance parentheses for `z.record(...)` calls, insert missing
  // `z.unknown()` value argument when the call only had a single key schema, and
  // remove duplicated trailing ')' tokens following the call.
  const repairRecordCalls = (src: string) => {
    const needle = "z.record(";
    let out = "";
    let i = 0;
    while (true) {
      const p = src.indexOf(needle, i);
      if (p === -1) {
        out += src.slice(i);
        break;
      }
      out += src.slice(i, p);
      let k = p + needle.length;
      let depth = 1;
      let inSingle = false;
      let inDouble = false;
      let inBack = false;
      let escaped = false;
      let end = -1;
      for (; k < src.length; k++) {
        const ch = src[k];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (inSingle) {
          if (ch === "'") {
            inSingle = false;
          }
          continue;
        }
        if (inDouble) {
          if (ch === '"') {
            inDouble = false;
          }
          continue;
        }
        if (inBack) {
          if (ch === "`") {
            inBack = false;
          }
          continue;
        }
        if (ch === "'") {
          inSingle = true;
          continue;
        }
        if (ch === '"') {
          inDouble = true;
          continue;
        }
        if (ch === "`") {
          inBack = true;
          continue;
        }
        if (ch === "(") {
          depth++;
          continue;
        }
        if (ch === ")") {
          depth--;
          if (depth === 0) {
            end = k;
            break;
          }
          continue;
        }
      }
      if (end === -1) {
        // malformed remainder; append rest and break
        out += src.slice(p);
        break;
      }

      const inner = src.slice(p + needle.length, end);

      // determine if there is a top-level comma in `inner`
      let hasTopComma = false;
      let pd = 0,
        bd = 0,
        cd = 0; // paren, bracket, brace depth for detection
      inSingle = inDouble = inBack = escaped = false;
      for (let m = 0; m < inner.length; m++) {
        const ch = inner[m];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (inSingle) {
          if (ch === "'") inSingle = false;
          continue;
        }
        if (inDouble) {
          if (ch === '"') inDouble = false;
          continue;
        }
        if (inBack) {
          if (ch === "`") inBack = false;
          continue;
        }
        if (ch === "'") {
          inSingle = true;
          continue;
        }
        if (ch === '"') {
          inDouble = true;
          continue;
        }
        if (ch === "`") {
          inBack = true;
          continue;
        }
        if (ch === "(") {
          pd++;
          continue;
        }
        if (ch === ")") {
          if (pd > 0) pd--;
          continue;
        }
        if (ch === "[") {
          bd++;
          continue;
        }
        if (ch === "]") {
          if (bd > 0) bd--;
          continue;
        }
        if (ch === "{") {
          cd++;
          continue;
        }
        if (ch === "}") {
          if (cd > 0) cd--;
          continue;
        }
        if (ch === "," && pd === 0 && bd === 0 && cd === 0) {
          hasTopComma = true;
          break;
        }
      }

      let replacedCall = null;
      if (!hasTopComma) {
        // single-arg form: insert z.unknown() as the second arg
        replacedCall = `${needle}${inner.trim()}, z.unknown())`;
      } else {
        // keep original text for call
        replacedCall = src.slice(p, end + 1);
      }

      // append the replacement
      out += replacedCall;

      // advance k to after end, and collapse any immediately following duplicated ')' tokens down to one
      let j = end + 1;
      // count consecutive ) characters
      let closeCount = 0;
      while (j < src.length && src[j] === ")") {
        closeCount++;
        j++;
      }
      if (closeCount > 0) {
        // we already emitted one ')' as part of replacement; if extra ) found, skip them
        // (effectively collapsing duplicates)
      }

      i = j;
    }
    return out;
  };

  code = fixGenerated(code);
  // Apply token-level repairs for z.record(...) cases
  code = repairRecordCalls(code);

  const internalGitSha = openApiDoc.info["x-internal-git-sha"] || "UNKNOWN";
  const banner = `// Auto-generated file (internal git SHA ${internalGitSha}) -- do not modify\n\n`;
  await fs.writeFile(OUTPUT_PATH, banner + code);

  // Format the generated file with prettier
  const { execSync } = await import("node:child_process");
  try {
    execSync(`./node_modules/.bin/prettier --write "${OUTPUT_PATH}"`, {
      cwd: path.join(SCRIPT_DIR, "../../.."),
      stdio: "inherit",
    });
  } catch (error) {
    console.warn("Warning: Could not format generated file with prettier");
  }
}

main();
