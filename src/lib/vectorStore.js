/**
 * vectorStore.js
 *
 * A minimal hand-rolled in-memory vector store — now with disk persistence.
 *
 * Phase 1: built cosine similarity search over an in-memory array.
 * Phase 3: adds save() and load() so we never re-embed the same repo twice.
 *
 * WHY JSON persistence instead of Chroma?
 *   Chroma requires a running server (Docker or a separate process). For a
 *   portfolio project, that's extra setup friction. Our JSON approach gives
 *   the same "skip re-embedding" benefit with zero infrastructure — just a
 *   file on disk. Swapping to Chroma later is a one-file change.
 *
 * HOW persistence works:
 *   save() → serialises { entries: [{vector, metadata, pageContent}] } to JSON
 *   load() → reads that JSON back and reconstructs the same store object
 *   The embeddings object is NOT stored (no need — we only embed at ingest time)
 */

import fs from "fs";
import path from "path";
import { HybridRetriever } from "./hybridRetriever.js";
import { registerRepo } from "./registry.js";

// ---------------------------------------------------------------------------
// Math helpers (same as Phase 1)
// ---------------------------------------------------------------------------

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

function norm(a) {
  return Math.sqrt(dot(a, a));
}

function cosineSimilarity(a, b) {
  const d = norm(a) * norm(b);
  return d === 0 ? 0 : dot(a, b) / d;
}

// ---------------------------------------------------------------------------
// Store factory — returns the same store object shape as Phase 1,
// now extended with save() and load()
// ---------------------------------------------------------------------------

/**
 * Builds an in-memory vector store from LangChain Documents.
 *
 * @param {import("@langchain/core/documents").Document[]} docs
 * @param {import("@langchain/core/embeddings").Embeddings} embeddings
 * @returns {Promise<VectorStore>}
 */
export async function buildVectorStore(docs, embeddings) {
  console.log(`  📦  Embedding ${docs.length} chunks…`);
  const vectors = await embeddings.embedDocuments(docs.map(d => d.pageContent));
  const entries = vectors.map((vector, i) => ({ vector, doc: docs[i] }));
  console.log(`  ✅  Vector store ready — ${entries.length} vectors in memory`);
  return makeStore(entries, embeddings);
}

/**
 * Loads a previously saved vector store from disk (skips re-embedding).
 *
 * @param {string} indexPath - Path to the saved .json index file
 * @param {import("@langchain/core/embeddings").Embeddings} embeddings
 * @returns {VectorStore}
 */
export function loadVectorStore(indexPath, embeddings) {
  let entries = [];
  try {
    const raw = fs.readFileSync(indexPath, "utf-8");
    const parsed = JSON.parse(raw);
    entries = parsed.entries || [];
    console.log(`  ✅  Loaded ${entries.length} vectors from ${indexPath}`);
  } catch (err) {
    console.error(`  ⚠️  Failed to parse index file at ${indexPath}: ${err.message}`);
    throw new Error(`Index file at ${indexPath} is corrupted or incomplete: ${err.message}. Please re-ingest with force: true.`);
  }
  return makeStore(entries, embeddings);
}

/**
 * Checks whether a persisted index exists for a given repo path.
 *
 * @param {string} repoPath
 * @returns {string|null} - The index file path if it exists, otherwise null
 */
export function findSavedIndex(repoPath) {
  const p = indexPathFor(repoPath);
  return fs.existsSync(p) ? p : null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Deterministic index path for a repo — stored next to the repo in .index/
 * e.g. repos/demo  →  .index/demo.json
 */
function indexPathFor(repoPath) {
  const name = path.basename(path.resolve(repoPath));
  return path.resolve(".index", `${name}.json`);
}

/**
 * Creates the store object — a plain object with search() and save().
 */
function makeStore(entries, embeddings) {
  // Precompute norms for fast cosine dot products (avoids recalculating norm(vector) 40,000 times per query)
  const entriesWithNorm = entries.map(e => ({
    vector: e.vector,
    doc: e.doc,
    norm: norm(e.vector) || 1,
  }));

  // Cache the HybridRetriever and BM25 index on the store instance
  let cachedHybrid = null;

  return {
    /**
     * Fast Cosine similarity search using precomputed norms.
     */
    async search(query, k = 5) {
      const queryVector = await embeddings.embedQuery(query);
      const qNorm = norm(queryVector) || 1;

      const scored = entriesWithNorm.map(({ vector, doc, norm: eNorm }) => ({
        doc,
        score: dot(queryVector, vector) / (qNorm * eNorm),
      }));
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, k).map(e => e.doc);
    },

    /**
     * Returns all stored documents.
     */
    getDocs() {
      return entries.map(e => e.doc);
    },

    /**
     * Returns a HybridRetriever combining this vector store + BM25 keyword search.
     * Caches the BM25 index so subsequent queries execute in <5ms without rebuilding.
     */
    asHybrid() {
      if (!cachedHybrid) {
        cachedHybrid = new HybridRetriever(this, entries.map(e => e.doc));
      }
      return cachedHybrid;
    },

    /**
     * Persists the store to disk so future runs skip re-embedding.
     * Creates the .index/ directory if it doesn't exist.
     *
     * @param {string} repoPath - Used to derive a deterministic file name
     */
    save(repoPath) {
      const filePath = indexPathFor(repoPath);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });

      // Serialize entries — vector (float array) + doc metadata + text
      const data = JSON.stringify({ entries }, null, 0); // no pretty-print = smaller file
      fs.writeFileSync(filePath, data, "utf-8");
      console.log(`  💾  Index saved to ${filePath}`);

      // Register repository in catalog
      const name = path.basename(path.resolve(repoPath));
      registerRepo(name, repoPath, entries.length);

      return filePath;
    },
  };
}
