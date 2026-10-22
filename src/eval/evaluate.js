/**
 * evaluate.js  —  Phase 2 eval harness
 *
 * Measures RETRIEVAL hit rate: for each question, did the expected file
 * appear anywhere in the top-k retrieved chunks?
 *
 * WHY retrieval hit rate (not answer quality)?
 *   Answer quality requires a human to judge each response, which doesn't
 *   scale.  Retrieval hit rate is automatic, objective, and directly measures
 *   the thing most likely to cause "I don't have enough context" failures:
 *   the right file not making it into the top-k.
 *
 *   If the right file IS retrieved, the LLM usually answers correctly.
 *   If it ISN'T retrieved, no prompt engineering can save you.
 *   So retrieval hit rate is the single most useful metric at this stage.
 *
 * Usage:
 *   node src/eval/evaluate.js <path-to-repo>
 *
 * Example:
 *   node src/eval/evaluate.js repos/demo
 */

import "dotenv/config";
import path from "path";
import { ingestRepo } from "../ingest.js";
import questions from "./questions.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const repoPath = path.resolve(process.argv[2] ?? "repos/demo");

// We test at multiple k values to understand the recall curve:
//   k=5  → what the user sees by default
//   k=10 → with the current workaround
//   k=20 → near-exhaustive for this small repo
const K_VALUES = [5, 10, 20];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=".repeat(60));
console.log("  📊  CampusCourier Retrieval Eval");
console.log(`  Repo: ${repoPath}`);
console.log(`  Questions: ${questions.length}`);
console.log("=".repeat(60));

// Step 1: Ingest once, reuse for all questions
const store = await ingestRepo(repoPath);
console.log("\nRunning evaluation…\n");

// Step 2: For each k, run all questions and count hits
const results = {}; // k -> { hits, misses: [{id, question, expected, got}] }

for (const k of K_VALUES) {
  results[k] = { hits: 0, misses: [] };

  for (const q of questions) {
    const docs = await store.search(q.question, k);

    // Retrieve the relative file paths of returned chunks
    const retrievedPaths = docs.map((d) =>
      // Normalise separators and strip the repo root so we can compare
      // "backend/src/routes/authRoutes.js" against the expected value
      d.metadata.source
        .replace(/\\/g, "/")          // Windows backslashes → forward
        .split("/repos/demo/")[1]     // strip everything up to the repo root
        ?? d.metadata.source
    );

    // A hit = at least one expected file appears in the retrieved paths
    const hit = q.expectedFiles.some((expected) =>
      retrievedPaths.some((rp) => rp && rp.includes(expected.replace(/\\/g, "/")))
    );

    if (hit) {
      results[k].hits++;
    } else {
      results[k].misses.push({
        id: q.id,
        question: q.question,
        expected: q.expectedFiles,
        retrieved: retrievedPaths.slice(0, 3), // show top-3 for debugging
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Print results
// ---------------------------------------------------------------------------

console.log("─".repeat(60));
console.log("  RETRIEVAL HIT RATE (did the right file appear in top-k?)");
console.log("─".repeat(60));

for (const k of K_VALUES) {
  const { hits } = results[k];
  const total = questions.length;
  const pct = ((hits / total) * 100).toFixed(0);
  const bar = "█".repeat(Math.round(hits / total * 20)).padEnd(20, "░");
  console.log(`  k=${String(k).padEnd(3)} │ ${bar} │ ${hits}/${total} (${pct}%)`);
}

// Show misses at the default k=5 so we know what to fix
const defaultK = 5;
const { misses } = results[defaultK];

if (misses.length > 0) {
  console.log(`\n  ❌  Misses at k=${defaultK} (${misses.length} questions):`);
  for (const m of misses) {
    console.log(`\n  Q${m.id}: "${m.question}"`);
    console.log(`    Expected : ${m.expected.join(", ")}`);
    console.log(`    Retrieved: ${m.retrieved.join(", ") || "(none)"}`);
  }
}

console.log("\n" + "─".repeat(60));
console.log("  ✅  Baseline recorded. Re-run after Phase 4 to compare.");
console.log("─".repeat(60) + "\n");
