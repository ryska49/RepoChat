/**
 * ingest.js
 *
 * Orchestrates the ingestion pipeline:
 *   walk files → split into chunks → embed → save vector store to disk
 *
 * Usage (internal — called by ask.js):
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
import { buildVectorStore } from "./lib/vectorStore.js";
/**
 * Full ingestion pipeline.  Returns the in-memory vector store.
 *
 * @param {string} repoPath - Path to the local repository directory
 * @returns {Promise<import("langchain/vectorstores/memory").MemoryVectorStore>}
 */
export async function ingestRepo(repoPath) {
  console.log(`\n🔍  Loading files from: ${repoPath}`);
  const files = loadRepoFiles(repoPath);
  console.log(`  📄  Found ${files.length} source files`);

  console.log(`\n✂️   Splitting files into chunks…`);
  const docs = await splitFiles(files);
  console.log(`  📄  Produced ${docs.length} chunks`); 

  console.log(`\n🧠  Building vector store…`);
  const embeddings = getEmbeddings();
  const store = await buildVectorStore(docs, embeddings);

  return store; 
}

// ---------------------------------------------------------------------------
// CLI entry point (node src/ingest.js <repo-path>)
// ---------------------------------------------------------------------------

// `import.meta.url` trick: only run when this file is the entry point
if (process.argv[1].endsWith("ingest.js")) {
  const repoPath = process.argv[2];
  if (!repoPath) {
    console.error("Usage: node src/ingest.js <path-to-repo>");
    process.exit(1);
  }
  await ingestRepo(repoPath);
  console.log("\n✅  Ingestion complete (in-memory, not persisted — use ask.js to query)");
}
