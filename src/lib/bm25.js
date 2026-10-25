/**
 * bm25.js
 *
 * Standalone Okapi BM25 implementation for code chunks.
 *
 * WHY BM25 alongside Vector Search?
 *   Vector embeddings are great at fuzzy concepts ("authentication logic")
 *   but weak at exact tokens ("authRoutes.js", "sendOtp", "req.params.id").
 *   BM25 specifically scores exact keyword matches in both the code content
 *   and the file path.
 *
 * Okapi BM25 formula:
 *   IDF * (TF * (k1 + 1)) / (TF + k1 * (1 - b + b * (|doc| / avgdl)))
 *   - k1 = 1.5 (controls term frequency saturation)
 *   - b = 0.75 (controls document length normalization penalty)
 */

// Tokenizer: splits text into alphanumeric words, lowercased
function tokenize(text) {
  if (!text) return [];
  // Also split camelCase (e.g. authRoutes -> auth, routes) for better code search
  const expanded = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  return expanded
    .toLowerCase()
    .replace(/[^a-z0-9_/.-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1);
}

export class BM25Index {
  /**
   * @param {import("@langchain/core/documents").Document[]} docs
   */
  constructor(docs) {
    this.docs = docs;
    this.k1 = 1.5;
    this.b = 0.75;
    this.docCount = docs.length;

    // Precompute doc tokens and lengths
    // We include metadata.source so exact filename matches (e.g. "authRoutes") get scored!
    this.docTokens = docs.map(d => {
      const pathText = (d.metadata?.source || "");
      return tokenize(`${pathText} ${pathText} ${d.pageContent}`);
    });

    this.docLengths = this.docTokens.map(tokens => tokens.length);
    const totalLength = this.docLengths.reduce((sum, len) => sum + len, 0);
    this.avgdl = totalLength / (this.docCount || 1);

    // Document frequency: how many docs contain term t
    this.df = new Map();
    for (const tokens of this.docTokens) {
      const unique = new Set(tokens);
      for (const token of unique) {
        this.df.set(token, (this.df.get(token) || 0) + 1);
      }
    }
  }

  /**
   * Search top-k documents using BM25 scoring
   * @param {string} query
   * @param {number} k
   * @returns {import("@langchain/core/documents").Document[]}
   */
  search(query, k = 5) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return this.docs.slice(0, k);

    const scores = new Float64Array(this.docCount);

    for (const token of queryTokens) {
      const docFreq = this.df.get(token) || 0;
      if (docFreq === 0) continue;

      // Standard BM25 IDF with smoothing
      const idf = Math.log(1 + (this.docCount - docFreq + 0.5) / (docFreq + 0.5));

      for (let i = 0; i < this.docCount; i++) {
        // Count term frequency in doc i
        const tokens = this.docTokens[i];
        let tf = 0;
        for (let j = 0; j < tokens.length; j++) {
          if (tokens[j] === token) tf++;
        }

        if (tf > 0) {
          const docLen = this.docLengths[i];
          const numerator = tf * (this.k1 + 1);
          const denominator = tf + this.k1 * (1 - this.b + this.b * (docLen / this.avgdl));
          scores[i] += idf * (numerator / denominator);
        }
      }
    }

    // Rank docs by score descending
    const ranked = this.docs
      .map((doc, idx) => ({ doc, score: scores[idx] }))
      .sort((a, b) => b.score - a.score);

    return ranked.slice(0, k).map(r => r.doc);
  }
}
