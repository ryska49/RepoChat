/**
 * hybridRetriever.js
 *
 * Implements Ensemble Hybrid Search using Reciprocal Rank Fusion (RRF).
 *
 * HOW RRF WORKS:
 *   For a given query:
 *   1. Retrieve top-N from Vector Store (semantic similarity)
 *   2. Retrieve top-N from BM25 (keyword matching)
 *   3. Combine scores using:
 *      RRF_score(doc) = 1 / (60 + rank_vector) + 1 / (60 + rank_bm25)
 *
 * WHY RRF?
 *   Scores from Vector search (cosine distance 0..1) and BM25 (arbitrary floats 0..50)
 *   cannot be directly added together because their scales and distributions differ.
 *   RRF bypasses scale differences by combining *ranks* instead of raw scores.
 */

import { BM25Index } from "./bm25.js";

export class HybridRetriever {
  /**
   * @param {Object} vectorStore - The in-memory or persisted vector store
   * @param {import("@langchain/core/documents").Document[]} docs - All repo chunks
   */
  constructor(vectorStore, docs) {
    this.vectorStore = vectorStore;
    this.docs = docs;
    this.bm25 = new BM25Index(docs);
    this.rrfConstant = 60; // Standard constant in information retrieval
  }

  /**
   * Perform hybrid search combining Vector + BM25 via Reciprocal Rank Fusion
   * @param {string} query
   * @param {number} k
   * @returns {Promise<import("@langchain/core/documents").Document[]>}
   */
  async search(query, k = 5) {
    // We retrieve a larger candidate pool (e.g. k * 3) from each retriever
    const candidateK = Math.max(k * 3, 20);

    // 1. Vector Search (Semantic)
    const vectorResults = await this.vectorStore.search(query, candidateK);

    // 2. BM25 Search (Keyword)
    const bm25Results = this.bm25.search(query, candidateK);

    // 3. Reciprocal Rank Fusion (RRF)
    const docScores = new Map(); // docId/key -> { doc, score }

    const getDocKey = (doc) => {
      const src = doc.metadata?.source || "";
      const start = doc.metadata?.startLine ?? "";
      const end = doc.metadata?.endLine ?? "";
      return `${src}#${start}-${end}`;
    };

    // Score vector results
    vectorResults.forEach((doc, rank) => {
      const key = getDocKey(doc);
      const score = 1 / (this.rrfConstant + rank + 1);
      docScores.set(key, { doc, score });
    });

    // Add BM25 results
    bm25Results.forEach((doc, rank) => {
      const key = getDocKey(doc);
      const rrfScore = 1 / (this.rrfConstant + rank + 1);
      if (docScores.has(key)) {
        docScores.get(key).score += rrfScore;
      } else {
        docScores.set(key, { doc, score: rrfScore });
      }
    });

    // 4. Sort by highest fused RRF score
    const fused = Array.from(docScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map(entry => entry.doc);

    return fused;
  }
}
