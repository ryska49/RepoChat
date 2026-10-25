/**
 * evaluate.js  —  Phase 4 Eval Harness: Vector vs Hybrid (BM25 + Vector)
 *
 * Compares:
 *   1. Vector-only Retrieval (Phase 2 baseline)
 *   2. Hybrid Retrieval (BM25 + Vector with Reciprocal Rank Fusion)
 *
 * Usage:
 *   node src/eval/evaluate.js repos/demo
 */

import "dotenv/config";
import path from "path";
import { ingestRepo } from "../ingest.js";
import questions from "./questions.json" with { type: "json" };

const repoPath = path.resolve(process.argv[2] ?? "repos/demo");
const K_VALUES = [5, 10, 20];

console.log("=".repeat(65));
console.log("  📊  CampusCourier Retrieval Eval: Vector vs Hybrid (BM25)");
console.log(`  Repo: ${repoPath}`);
console.log(`  Questions: ${questions.length}`);
console.log("=".repeat(65));

// Step 1: Load or ingest store
const store = await ingestRepo(repoPath);
const hybridRetriever = store.asHybrid();

console.log("\nRunning evaluation on both retrievers…\n");

async function evaluateRetriever(retriever, isHybrid = false) {
  const res = {};
  for (const k of K_VALUES) {
    res[k] = { hits: 0, misses: [] };
    for (const q of questions) {
      const docs = await retriever.search(q.question, k);

      const retrievedPaths = docs.map((d) =>
        d.metadata.source
          .replace(/\\/g, "/")
          .split("/repos/demo/")[1] ?? d.metadata.source
      );

      const hit = q.expectedFiles.some((expected) =>
        retrievedPaths.some((rp) => rp && rp.includes(expected.replace(/\\/g, "/")))
      );

      if (hit) {
        res[k].hits++;
      } else {
        res[k].misses.push({
          id: q.id,
          question: q.question,
          expected: q.expectedFiles,
          retrieved: retrievedPaths.slice(0, 3),
        });
      }
    }
  }
  return res;
}

const vectorResults = await evaluateRetriever(store, false);
const hybridResults = await evaluateRetriever(hybridRetriever, true);

// ---------------------------------------------------------------------------
// Print Comparison Table
// ---------------------------------------------------------------------------

console.log("─".repeat(65));
console.log("  RETRIEVAL HIT RATE COMPARISON");
console.log("─".repeat(65));
console.log("  k    │ Vector (Baseline) │ Hybrid (BM25 + Vector) │ Improvement");
console.log("───────┼───────────────────┼────────────────────────┼────────────");

const total = questions.length;

for (const k of K_VALUES) {
  const vHits = vectorResults[k].hits;
  const hHits = hybridResults[k].hits;
  const vPct = ((vHits / total) * 100).toFixed(0);
  const hPct = ((hHits / total) * 100).toFixed(0);
  const diff = hHits - vHits;
  const diffStr = diff > 0 ? `+${diff} (+${(((hHits - vHits) / total) * 100).toFixed(0)}%)` : (diff === 0 ? "0 (tie)" : `${diff}`);

  console.log(
    `  k=${String(k).padEnd(3)} │ ${String(vHits).padStart(2)}/${total} (${String(vPct).padStart(2)}%)      │ ${String(hHits).padStart(2)}/${total} (${String(hPct).padStart(2)}%)           │ ${diffStr}`
  );
}

console.log("─".repeat(65));

// Show misses at k=5 for Hybrid
const defaultK = 5;
const hMisses = hybridResults[defaultK].misses;

if (hMisses.length > 0) {
  console.log(`\n  Remaining misses in Hybrid at k=${defaultK} (${hMisses.length} questions):`);
  for (const m of hMisses) {
    console.log(`\n  Q${m.id}: "${m.question}"`);
    console.log(`    Expected : ${m.expected.join(", ")}`);
    console.log(`    Retrieved: ${m.retrieved.join(", ") || "(none)"}`);
  }
} else {
  console.log(`\n  🎉 Zero misses at k=${defaultK}! Perfect 100% retrieval.`);
}

console.log("\n" + "=".repeat(65) + "\n");
