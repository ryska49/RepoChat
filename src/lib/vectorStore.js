/**
 * vectorStore.js
 *
 * A minimal hand-rolled in-memory vector store.
 *
 * WHY build our own?
 *   LangChain.js v1 removed MemoryVectorStore from its public API (it moved to
 *   an internal helper). Rather than chasing the new internal path (which may
 *   change again), we write the ~30 lines ourselves. It's a great way to
 *   understand what a vector store actually does:
 *
 *     store  = array of { vector, document }
 *     search = embed the query, compute cosine similarity against every stored
 *              vector, return the top-k highest-scoring documents
 *
 * HOW cosine similarity works:
 *   similarity(A, B) = (A · B) / (|A| * |B|)
 *   Two vectors pointing the same direction → similarity = 1.0  (identical meaning)
 *   Two vectors perpendicular              → similarity = 0.0  (unrelated)
 *   Because our embedder normalizes vectors (normalize:true), |A| = |B| = 1,
 *   so similarity = A · B  (just the dot product — very fast).
 */

// ---------------------------------------------------------------------------
// Math helpers
// ---------------------------------------------------------------------------

/** Dot product of two same-length arrays. */
function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/** L2 norm (length) of a vector. */
function norm(a) {
  return Math.sqrt(dot(a, a));
}

/** Cosine similarity between two vectors (0–1 for normalized embeddings). */
function cosineSimilarity(a, b) {
  const denominator = norm(a) * norm(b);
  if (denominator === 0) return 0;
  return dot(a, b) / denominator;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds an in-memory vector store from an array of LangChain Documents.
 * Returns a plain object (not a class) — a simple array with a search method.
 *
 * @param {import("@langchain/core/documents").Document[]} docs
 * @param {import("@langchain/core/embeddings").Embeddings} embeddings
 * @returns {Promise<{ search: (query: string, k: number) => Promise<Document[]> }>}
 */
export async function buildVectorStore(docs, embeddings) {
  console.log(`  📦  Embedding ${docs.length} chunks — first run downloads the model (~22 MB)…`);

  // Embed all document texts in one call (batched internally by the model)
  const vectors = await embeddings.embedDocuments(docs.map(d => d.pageContent));

  // Pair each vector with its document
  const entries = vectors.map((vector, i) => ({ vector, doc: docs[i] }));

  console.log(`  ✅  Vector store ready — ${entries.length} vectors in memory`);

  return {
    /**
     * Find the top-k documents most similar to the query string.
     * @param {string} query
     * @param {number} k
     * @returns {Promise<import("@langchain/core/documents").Document[]>}
     */
    async search(query, k = 5) {
      const queryVector = await embeddings.embedQuery(query);

      // Score every entry and sort descending
      const scored = entries.map(({ vector, doc }) => ({
        doc,
        score: cosineSimilarity(queryVector, vector),
      }));

      scored.sort((a, b) => b.score - a.score);

      return scored.slice(0, k).map(({ doc }) => doc);
    },
  };
}
