/**
 * ask.js  —  CLI entry point for Phase 1
 *
 * Usage:
 *   node src/ask.js <path-to-repo> "<your question>"
 *
 * Example:
 *   node src/ask.js repos/demo "where is authentication handled?"
 *
 * What happens:
 *   1. Ingest the repo (walk → split → embed → in-memory store)
 *   2. Embed the question and retrieve the top-k closest chunks
 *   3. Send chunks + question to Groq (Llama 3.3 70B), receive a cited answer
 *   4. Print the answer and the raw retrieved chunks for inspection
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

// Step 2: Retrieve — store.search() is our hand-rolled cosine similarity search
console.log(`\n🔎  Retrieving top ${topK} chunks…`);
const docs = await store.search(question, topK);

// Step 3: Show retrieved sources (helpful for debugging / eval)
console.log("\n📎  Retrieved sources:");
for (const doc of docs) {
  const { source, startLine, endLine } = doc.metadata;
  const lineRange = startLine ? `L${startLine}-L${endLine}` : "?";
  // Trim the repo root from path for readability
  const relPath = source.replace(repoPath, "").replace(/^[\\/]/, "");
  console.log(`  • ${relPath}:${lineRange}`);
}

// In debug mode (DEBUG=1 node src/ask.js ...) also print chunk text
// so you can see exactly what the model is working with
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

