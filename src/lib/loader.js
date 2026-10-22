/**
 * loader.js
 *
 * Walks a repository directory and returns an array of { filePath, content }
 * objects for every text-based source file, skipping anything that would
 * pollute the index (node_modules, binaries, lock files, etc.).
 *
 * WHY: LangChain documents need raw text. We produce that text here before
 * handing off to the splitter.
 */

import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Directories we never descend into. */
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".nuxt",
  "coverage",
  "__pycache__",
  ".venv",
  "venv",
  ".cache",
]);

/** File extensions we consider "text/source". Everything else is skipped. */
const ALLOWED_EXTENSIONS = new Set([
  // Web / JS ecosystem
  ".js", ".mjs", ".cjs", ".jsx",
  ".ts", ".tsx", ".mts",
  ".html", ".css", ".scss", ".sass",
  // Config / data
  ".json", ".yaml", ".yml", ".toml", ".ini", ".env.example",
  // Python
  ".py",
  // Docs
  ".md", ".mdx", ".txt",
  // Shell
  ".sh", ".bash", ".zsh",
  // Other languages
  ".java", ".go", ".rs", ".rb", ".php", ".c", ".cpp", ".h", ".hpp",
  ".cs", ".swift", ".kt",
  // SQL
  ".sql",
]);

/** Exact file names to always skip, regardless of extension. */
const SKIP_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
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
 * @param {string} repoPath - Absolute or relative path to the repo root.
 * @returns {{ filePath: string, content: string }[]}
 */
export function loadRepoFiles(repoPath) {
  const results = [];
  walk(path.resolve(repoPath), results);
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
    // Permission errors, broken symlinks, etc. — skip silently.
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        walk(fullPath, results); // recurse
      }
      continue;
    }

    if (!entry.isFile()) continue; // symlinks, sockets, etc.

    if (SKIP_FILES.has(entry.name)) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    // Read the file — skip if it's unreadable or suspiciously large (> 500 KB)
    try {
      const stat = fs.statSync(fullPath);
      if (stat.size > 500_000) continue; // likely generated / minified

      const content = fs.readFileSync(fullPath, "utf-8");
      results.push({ filePath: fullPath, content });
    } catch {
      // Binary file masquerading as text, etc. — skip.
      continue;
    }
  }
}
