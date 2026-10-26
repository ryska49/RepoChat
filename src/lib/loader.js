/**
 * loader.js
 *
 * Walks a repository directory and returns an array of { filePath, content }
 * objects for every text-based source file, skipping anything that would
 * pollute the index (node_modules, vendor, test fixtures, binaries, lock files, etc.).
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directories we never descend into. */
const SKIP_DIRS = new Set([
  // Dependencies & package managers
  "node_modules",
  "vendor", // PHP Composer dependencies
  "pods",
  "Pods",
  ".venv",
  "venv",
  "env",

  // Version control & editors
  ".git",
  ".github",
  ".vscode",
  ".idea",
  ".cursor",
  ".claude",
  ".ai",
  ".agents",

  // Build & compiled outputs
  "dist",
  "build",
  "target", // Rust/Java
  "bin",
  "obj",
  ".next",
  ".nuxt",
  "out",
  ".output",
  "coverage",
  "__pycache__",
  ".cache",
  ".turbo",

  // Large assets, storage & docs that bloat embedding
  "docs",
  "documentation",
  "changelogs",
  "changelog",
  "tests",
  "test",
  "__tests__",
  "storage",
  "public",
  "svgs",
  "templates",
]);

/** File extensions we consider "text/source". Everything else is skipped. */
const ALLOWED_EXTENSIONS = new Set([
  // Web / JS / TS ecosystem
  ".js", ".mjs", ".cjs", ".jsx",
  ".ts", ".tsx", ".mts",
  ".html", ".css",
  // Config & data
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env.example",
  // Backend languages
  ".py",
  ".go",
  ".rs",
  ".java",
  ".php",
  ".rb",
  ".cpp", ".c", ".h", ".hpp",
  ".cs",
  ".swift",
  ".kt",
  ".sql",
  // Docs & shell
  ".md", ".sh",
]);

// Exact file names to always skip
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "composer.lock",
  ".DS_Store",
  "Thumbs.db",
]);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Recursively walks `repoPath` and returns an array of objects:
 *   { filePath: string, content: string }
 *
 * @param {string} repoPath
 * @returns {{ filePath: string, content: string }[]}
 */
export function loadRepoFiles(repoPath) {
  const results = [];
  const resolved = path.resolve(repoPath);

  if (!fs.existsSync(resolved)) {
    throw new Error(`Directory does not exist: "${resolved}"`);
  }

  walk(resolved, results);
  return results;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function walk(dir, results) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name.toLowerCase())) {
        walk(fullPath, results);
      }
      continue;
    }

    if (!entry.isFile()) continue;

    if (SKIP_FILES.has(entry.name)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    try {
      const stat = fs.statSync(fullPath);
      // Skip files larger than 150 KB (minified bundles, giant generated openapi schemas)
      if (stat.size > 150_000) continue;

      const content = fs.readFileSync(fullPath, "utf-8");
      results.push({ filePath: fullPath, content });
    } catch {
      continue;
    }
  }
}
