/**
 * src/server/index.js  —  Express API server (Phase 3)
 *
 * Two endpoints:
 *
 *   POST /ingest
 *     Body: { "repoPath": "./repos/demo", "force": false }
 *     Walks + embeds a repo and saves the index to disk.
 *     Subsequent calls with the same repo are instant (loads from cache).
 *
 *   POST /ask
 *     Body: { "question": "...", "repoPath": "./repos/demo", "topK": 10 }
 *     Streams the answer back as Server-Sent Events (SSE).
 *     The client reads the stream token-by-token for a typing effect.
 *
 * WHY SSE instead of WebSockets?
 *   SSE is one-directional (server → client), which is all we need for
 *   streaming an LLM answer. It's simpler than WebSockets: just HTTP with
 *   chunked transfer encoding, works through proxies, and is natively
 *   supported by the browser's EventSource API and fetch().
 *
 * Run with:
 *   npm run serve
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { ingestRepo } from "../ingest.js";
import { getEmbeddings } from "../lib/embedder.js";
import { loadVectorStore, findSavedIndex } from "../lib/vectorStore.js";
import { streamAnswer } from "../lib/retriever.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// In-memory cache of loaded stores so we don't re-read disk on every request
// key: resolved repoPath, value: VectorStore
// ---------------------------------------------------------------------------
const storeCache = new Map();

async function getStore(repoPath, force = false) {
  const resolved = path.resolve(repoPath);

  if (!force && storeCache.has(resolved)) {
    return storeCache.get(resolved); // already in memory this session
  }

  // Try loading from disk first (fast), fall back to full ingest (slow)
  let store;
  const savedPath = !force && findSavedIndex(resolved);
  if (savedPath) {
    console.log(`[ingest] Loading from disk: ${savedPath}`);
    store = loadVectorStore(savedPath, getEmbeddings());
  } else {
    console.log(`[ingest] Full ingest of: ${resolved}`);
    store = await ingestRepo(resolved, { force });
  }

  storeCache.set(resolved, store);
  return store;
}

// ---------------------------------------------------------------------------
// POST /ingest
// ---------------------------------------------------------------------------

app.post("/ingest", async (req, res) => {
  const { repoPath, force = false } = req.body;

  if (!repoPath) {
    return res.status(400).json({ error: "repoPath is required" });
  }

  try {
    const start = Date.now();
    await getStore(repoPath, force);
    const ms = Date.now() - start;

    res.json({
      ok: true,
      repoPath,
      message: force ? `Re-ingested in ${ms}ms` : `Ready in ${ms}ms (loaded from cache if available)`,
    });
  } catch (err) {
    console.error("[ingest error]", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /ask  (streaming SSE)
// ---------------------------------------------------------------------------

app.post("/ask", async (req, res) => {
  const { question, repoPath = "repos/demo", topK = 10 } = req.body;

  if (!question) {
    return res.status(400).json({ error: "question is required" });
  }

  // ── Set SSE headers BEFORE any async work so the client connects fast ──
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // send headers immediately — client is now listening

  /** Helper: send one SSE frame */
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Load (or build) the vector store for this repo
    const store = await getStore(repoPath);

    // 2. Retrieve top-k chunks
    const docs = await store.search(question, topK);

    // 3. Emit citation metadata first so the client can render sources immediately
    const absRepo = path.resolve(repoPath);
    const sources = docs.map(d => ({
      // Return a relative path (strips the machine-specific repo root)
      file: d.metadata.source.replace(absRepo, "").replace(/^[\\/]/, "").replace(/\\/g, "/"),
      startLine: d.metadata.startLine,
      endLine: d.metadata.endLine,
    }));
    send("sources", { sources });

    // 4. Stream the LLM answer token by token
    for await (const token of streamAnswer(docs, question)) {
      send("token", { token });
    }

    // 5. Signal completion
    send("done", { ok: true });
    res.end();

  } catch (err) {
    console.error("[ask error]", err);
    send("error", { error: err.message });
    res.end();
  }
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  console.log(`\n🚀  Codebase Q&A API running at http://localhost:${PORT}`);
  console.log(`    POST /ingest  { repoPath }`);
  console.log(`    POST /ask     { question, repoPath, topK }`);
  console.log(`    GET  /health\n`);
});
