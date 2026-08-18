import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const ROOTS = ["src", "tests", "scripts", "automation", "src-tauri/src", "src-tauri/tests"];
export const SOURCE_EXTENSIONS = new Set([".cjs", ".js", ".mjs", ".rs", ".ts", ".vue"]);
export const HARD_LIMIT = 1_000;
export const REVIEW_LIMIT = 500;

export async function sourceFiles(root) {
  const files = [];

  async function visit(relativeDir) {
    const absoluteDir = path.join(root, relativeDir);
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        await visit(relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!SOURCE_EXTENSIONS.has(path.extname(entry.name))) continue;
      files.push(path.join(root, relativePath));
    }
  }

  await visit("");
  return files;
}

export async function checkFileSizes({
  roots = ROOTS,
  hardLimit = HARD_LIMIT,
  reviewLimit = REVIEW_LIMIT,
} = {}) {
  const files = (await Promise.all(roots.map(sourceFiles))).flat().sort();
  const results = await Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, "utf8");
      return { file, lines: content === "" ? 0 : content.split(/\r?\n/).length };
    }),
  );
  return {
    files: results,
    review: results.filter(({ lines }) => lines > reviewLimit && lines <= hardLimit),
    oversized: results.filter(({ lines }) => lines > hardLimit),
  };
}

export function formatFileSizeReport(result, { hardLimit = HARD_LIMIT } = {}) {
  const lines = result.review.map(({ file, lines }) => `review: ${file} (${lines} lines)`);
  if (result.oversized.length === 0) {
    lines.push(
      `file-size gate passed: ${result.files.length} handwritten source files <= ${hardLimit} lines`,
    );
  } else {
    lines.push(
      ...result.oversized.map(
        ({ file, lines: count }) => `error: ${file} has ${count} lines (limit ${hardLimit})`,
      ),
    );
  }
  return lines.join("\n");
}

export async function main() {
  const result = await checkFileSizes();
  const report = formatFileSizeReport(result);
  (result.oversized.length ? console.error : console.log)(report);
  return result.oversized.length ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().then((code) => {
    process.exitCode = code;
  });
}
