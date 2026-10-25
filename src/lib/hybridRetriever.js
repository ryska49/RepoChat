/**
 * hybridRetriever.js
 *
 * Implements Ensemble Hybrid Search using Reciprocal Rank Fusion (RRF),
 * with intelligent query intent routing for high-level repository overviews.
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
    this.rrfConstant = 60;
  }

  /**
   * Detects if the user is asking a high-level question about the project's purpose,
   * architecture, or overall repository function.
   */
  isOverviewQuery(query) {
    const q = query.trim().toLowerCase();
    return (
      /what (does|is) (this|the) (repo|repository|project|codebase|app|system|api)/i.test(q) ||
      /explain (this|the) (repo|repository|project|codebase|architecture)/i.test(q) ||
      /overview of (this|the) (repo|repository|project|codebase)/i.test(q) ||
      /(tech stack|architecture|project purpose|what is this)/i.test(q)
    );
  }

  /**
   * Perform hybrid search combining Vector + BM25 via Reciprocal Rank Fusion
   * @param {string} query
   * @param {number} k
   * @returns {Promise<import("@langchain/core/documents").Document[]>}
   */
  async search(query, k = 5) {
    const candidateK = Math.max(k * 3, 20);

    // 1. Vector Search (Semantic)
    const vectorResults = await this.vectorStore.search(query, candidateK);

    // 2. BM25 Search (Keyword)
    const bm25Results = this.bm25.search(query, candidateK);

    // 3. Reciprocal Rank Fusion (RRF)
    const docScores = new Map();

    const getDocKey = (doc) => {
      const src = doc.metadata?.source || "";
      const start = doc.metadata?.startLine ?? "";
      const end = doc.metadata?.endLine ?? "";
      return `${src}#${start}-${end}`;
    };

    vectorResults.forEach((doc, rank) => {
      const key = getDocKey(doc);
      const score = 1 / (this.rrfConstant + rank + 1);
      docScores.set(key, { doc, score });
    });

    bm25Results.forEach((doc, rank) => {
      const key = getDocKey(doc);
      const rrfScore = 1 / (this.rrfConstant + rank + 1);
      if (docScores.has(key)) {
        docScores.get(key).score += rrfScore;
      } else {
        docScores.set(key, { doc, score: rrfScore });
      }
    });

    // 4. Boost overview files if user is asking a repository-level question
    if (this.isOverviewQuery(query)) {
      for (const entry of docScores.values()) {
        const src = (entry.doc.metadata?.source || "").toLowerCase();
        if (
          src.includes("readme") ||
          src.includes("package.json") ||
          src.includes("server.js") ||
          src.includes("index.js") ||
          src.includes("app.js") ||
          src.includes("docker-compose") ||
          src.includes("routes")
        ) {
          entry.score += 0.05; // Significant boost for project identity files
        }
      }

      // Also ensure key overview chunks are present in candidate pool
      const keyDocs = this.docs.filter((d) => {
        const src = (d.metadata?.source || "").toLowerCase();
        return (
          src.includes("package.json") ||
          src.includes("readme") ||
          src.endsWith("server.js") ||
          src.endsWith("index.js") ||
          src.endsWith("app.js")
        );
      });

      for (const d of keyDocs) {
        const key = getDocKey(d);
        if (!docScores.has(key)) {
          docScores.set(key, { doc: d, score: 0.04 });
        }
      }
    }

    // Sort by highest fused RRF score
    const fused = Array.from(docScores.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, k)
      .map((entry) => entry.doc);

    return fused;
  }
}
