/**
 * embedder.js
 *
 * A custom LangChain-compatible Embeddings class built directly on top of
 * @huggingface/transformers (Transformers.js).
 *
 * WHY not use @langchain/community's HuggingFaceTransformersEmbeddings?
 *   @langchain/community was deprecated in Oct 2025. Rather than depend on a
 *   dead package, we implement the two-method Embeddings interface ourselves.
 *   It's only ~30 lines and teaches you exactly what LangChain expects.
 *
 * WHY a local model?
 *   Claude (Anthropic) has no embeddings API, so we need another source.
 *   Running locally means zero cost, zero latency variance, and privacy —
 *   your code never leaves the machine during ingestion.
 *
 * WHY all-MiniLM-L6-v2?
 *   It's tiny (22 MB), fast, and performs well on semantic search for a
 *   general-purpose model.  We can swap to a code-specific model later if
 *   eval scores motivate it.
 *
 * HOW the Embeddings interface works:
 *   LangChain only needs two methods on an embeddings object:
 *     - embedDocuments(texts: string[]): Promise<number[][]>
 *     - embedQuery(text: string): Promise<number[]>
 *   We extend the base Embeddings class so LangChain treats us as a first-class
 *   embeddings provider.
 */

import { Embeddings } from "@langchain/core/embeddings";
import { pipeline } from "@huggingface/transformers";

class LocalTransformersEmbeddings extends Embeddings {
  constructor() {
    super({});
    this._pipe = null; // lazy-loaded on first call
  }

  /** Lazy-initialise the feature-extraction pipeline (downloads model once). */
  async _init() {
    if (!this._pipe) {
      console.log("  🔽  Loading embedding model (first run downloads ~22 MB)…");
      this._pipe = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
      console.log("  ✅  Embedding model ready");
    }
  }

  /**
   * Embed an array of documents.  Called during ingestion.
   * @param {string[]} texts
   * @returns {Promise<number[][]>}
   */
  async embedDocuments(texts) {
    await this._init();
    const results = [];
    for (const text of texts) {
      // pooling:"mean" averages token vectors → single sentence vector
      // normalize:true makes cosine similarity equal to dot product (faster)
      const output = await this._pipe(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data));
    }
    return results;
  }

  /**
   * Embed a single query string.  Called at retrieval time.
   * @param {string} text
   * @returns {Promise<number[]>}
   */
  async embedQuery(text) {
    const [vec] = await this.embedDocuments([text]);
    return vec;
  }
}

/** Singleton — one pipeline instance shared across the whole process. */
let _embeddings = null;

export function getEmbeddings() {
  if (!_embeddings) {
    _embeddings = new LocalTransformersEmbeddings();
  }
  return _embeddings;
}
