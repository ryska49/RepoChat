/**
 * ask.js  —  CLI entry point for Phase 1 & Phase 4
 *
 * Usage:
 *   node src/ask.js <path-to-repo> "<your question>"
 *
 * Example:
 *   node src/ask.js repos/demo "where is routing handled?"
 */

import "dotenv/config";
import { ingestRepo } from "./ingest.js";
import { generateAnswer } from "./lib/retriever.js";
import path from "path";

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const [, , repoPathArg, ...questionParts] = process.argv;
const question = questionParts.join(" ");

if (!repoPathArg || !question) {
  console.error('Usage: node src/ask.js <path-to-repo> "<question>"');
  process.exit(1);
}

const repoPath = path.resolve(repoPathArg);
const topK = parseInt(process.env.TOP_K ?? "5", 10);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=".repeat(60));
console.log(`  Question: ${question}`);
console.log(`  Repo    : ${repoPath}`);
console.log("=".repeat(60));

// Step 1: Ingest (walk → split → embed → store)
const store = await ingestRepo(repoPath);
const retriever = store.asHybrid();

// Step 2: Retrieve — Hybrid Search (Vector + BM25 keyword search)
console.log(`\n🔎  Retrieving top ${topK} chunks with Hybrid Search (BM25 + Vector)…`);
const docs = await retriever.search(question, topK);

// Step 3: Show retrieved sources (helpful for debugging / eval)
console.log("\n📎  Retrieved sources:");
for (const doc of docs) {
  const { source, startLine, endLine } = doc.metadata;
  const lineRange = startLine ? `L${startLine}-L${endLine}` : "?";
  const relPath = source.replace(repoPath, "").replace(/^[\\/]/, "");
  console.log(`  • ${relPath}:${lineRange}`);
}

if (process.env.DEBUG === "1") {
  console.log("\n📄  Chunk contents:");
  for (const doc of docs) {
    const relPath = doc.metadata.source.replace(repoPath, "").replace(/^[\\/]/, "");
    console.log(`\n  ── ${relPath} ──`);
    console.log(doc.pageContent.slice(0, 400) + (doc.pageContent.length > 400 ? "\n  …(truncated)" : ""));
  }
}

// Step 4: Generate answer
console.log("\n🤖  Generating answer…\n");
const answer = await generateAnswer(docs, question);

console.log("─".repeat(60));
console.log(answer);
console.log("─".repeat(60));
