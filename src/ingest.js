/**
 * ingest.js
 *
 * Orchestrates the ingestion pipeline:
 *   walk files → split → embed → vector store → save to disk
 *
 * Phase 3 addition: if a saved index already exists for this repo, we load it
 * from disk instead of re-embedding — saving 30+ seconds on every restart.
 *
 * Usage (imported by ask.js and the Express server):
 *   import { ingestRepo } from "./ingest.js";
 *   const store = await ingestRepo("./repos/demo");
 *
 * Or run directly to pre-build the index:
 *   node src/ingest.js <repo-path>
 */

import "dotenv/config";
import { loadRepoFiles } from "./lib/loader.js";
import { splitFiles } from "./lib/splitter.js";
import { getEmbeddings } from "./lib/embedder.js";
import { buildVectorStore, loadVectorStore, findSavedIndex } from "./lib/vectorStore.js";

/**
 * Full ingestion pipeline. Returns a ready-to-query vector store.
 * Loads from disk cache if available; re-embeds only when forced.
 *
 * @param {string} repoPath
 * @param {{ force?: boolean }} options - force:true re-embeds even if cached
 * @returns {Promise<VectorStore>}
 */
export async function ingestRepo(repoPath, { force = false } = {}) {
  const embeddings = getEmbeddings();

  // ── Fast path: load from disk if already ingested ──────────────────────
  if (!force) {
    const savedPath = findSavedIndex(repoPath);
    if (savedPath) {
      console.log(`\n⚡  Found saved index — loading from disk (skipping re-embed)`);
      return loadVectorStore(savedPath, embeddings);
    }
  }

  // ── Slow path: full ingestion ───────────────────────────────────────────
  console.log(`\n🔍  Loading files from: ${repoPath}`);
  const files = loadRepoFiles(repoPath);
  console.log(`  📄  Found ${files.length} source files`);

  if (files.length === 0) {
    throw new Error(`No recognized source code files found in "${repoPath}". Please verify the folder exists and contains code files.`);
  }

  console.log(`\n✂️   Splitting files into chunks…`);
  const docs = await splitFiles(files);
  console.log(`  📄  Produced ${docs.length} chunks`);

  console.log(`\n🧠  Building vector store…`);
  const store = await buildVectorStore(docs, embeddings);

  // Save so the next run is instant
  store.save(repoPath);

  return store;
}

// ---------------------------------------------------------------------------
// CLI entry point: node src/ingest.js <repo-path> [--force]
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith("ingest.js")) {
  const args = process.argv.slice(2);
  const repoPath = args.find(a => !a.startsWith("--"));
  const force = args.includes("--force");

  if (!repoPath) {
    console.error("Usage: node src/ingest.js <path-to-repo> [--force]");
    process.exit(1);
  }

  await ingestRepo(repoPath, { force });
  console.log("\n✅  Ingestion complete");
}
