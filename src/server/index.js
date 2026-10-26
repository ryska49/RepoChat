/**
 * src/server/index.js  —  Express API server (Phase 3, 4 & 5)
 *
 * Endpoints:
 *   POST /ingest
 *   POST /ask (streaming SSE with Hybrid BM25 + Vector Search)
 *   GET  /file (fetch code lines for interactive citation viewer)
 *   GET  /repos (list available repositories)
 *   GET  /health
 */

import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { execSync } from "child_process";
import { ingestRepo } from "../ingest.js";
import { getEmbeddings } from "../lib/embedder.js";
import { loadVectorStore, findSavedIndex } from "../lib/vectorStore.js";
import { streamAnswer } from "../lib/retriever.js";
import { getRegistry } from "../lib/registry.js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// In-memory cache of loaded stores
const storeCache = new Map();

export function resolveRepoDirectory(repoPath) {
  const registry = getRegistry();
  const matched = registry.find(r => r.id === repoPath || r.name === repoPath || r.path === repoPath);
  const targetPath = matched ? matched.path : repoPath;
  return path.resolve(targetPath);
}

async function getStore(repoPath, force = false) {
  const registry = getRegistry();
  const matched = registry.find(r => r.id === repoPath || r.name === repoPath || r.path === repoPath);
  const resolved = resolveRepoDirectory(repoPath);

  if (!force && storeCache.has(resolved)) {
    return storeCache.get(resolved);
  }

  let store;
  const savedPath = !force && (matched?.indexPath || findSavedIndex(resolved) || findSavedIndex(repoPath));
  if (savedPath && fs.existsSync(savedPath)) {
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
  let { repoPath, force = false } = req.body;

  if (!repoPath || typeof repoPath !== "string") {
    return res.status(400).json({ error: "repoPath or GitHub URL is required" });
  }

  repoPath = repoPath.trim();

  // Normalize shorthand GitHub URLs e.g. "expressjs/express" -> "https://github.com/expressjs/express"
  if (/^[a-zA-Z0-9_\-.]+\/[a-zA-Z0-9_\-.]+$/.test(repoPath) && !fs.existsSync(path.resolve(repoPath))) {
    repoPath = `https://github.com/${repoPath}`;
  }

  // Handle GitHub URLs
  if (repoPath.startsWith("http://") || repoPath.startsWith("https://") || repoPath.startsWith("git@")) {
    try {
      const cleanUrl = repoPath.replace(/\.git$/, "").replace(/\/+$/, "");
      const repoName = cleanUrl.split("/").pop() || "cloned-repo";
      const targetDir = path.resolve("repos", repoName);

      if (!fs.existsSync(targetDir)) {
        console.log(`[git] Cloning ${cleanUrl} into ${targetDir}...`);
        fs.mkdirSync(path.dirname(targetDir), { recursive: true });
        // Set a 2-minute timeout for cloning
        execSync(`git clone --depth 1 "${cleanUrl}" "${targetDir}"`, {
          stdio: "pipe",
          timeout: 120000,
        });
        console.log(`[git] Clone completed successfully for ${repoName}!`);
      } else {
        console.log(`[git] Repo already exists locally at ${targetDir}`);
      }

      repoPath = `repos/${repoName}`;
    } catch (cloneErr) {
      console.error("[git clone error]", cloneErr);
      const errMsg = cloneErr.stderr ? cloneErr.stderr.toString() : cloneErr.message;
      return res.status(500).json({ error: `Git clone failed: ${errMsg}` });
    }
  }

  try {
    const start = Date.now();
    const store = await getStore(repoPath, force);
    const ms = Date.now() - start;
    const docs = store.getDocs ? store.getDocs() : [];

    res.json({
      ok: true,
      repoPath,
      name: path.basename(path.resolve(repoPath)),
      chunkCount: docs.length,
      message: force ? `Re-ingested in ${ms}ms` : `Ready in ${ms}ms (loaded from cache if available)`,
    });
  } catch (err) {
    console.error("[ingest error]", err);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------------------
// POST /ask  (streaming SSE with Hybrid Search)
// ---------------------------------------------------------------------------

app.post("/ask", async (req, res) => {
  const { question, repoPath = "repos/demo", topK = 10 } = req.body;

  if (!question) {
    return res.status(400).json({ error: "question is required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // 1. Load the vector store
    const store = await getStore(repoPath);

    // 2. Hybrid Retrieve top-k chunks (BM25 + Vector)
    const hybridRetriever = store.asHybrid();
    const docs = await hybridRetriever.search(question, topK);

    // 3. Emit citation metadata first
    const absRepo = resolveRepoDirectory(repoPath);
    const sources = docs.map(d => {
      let rawPath = d.metadata?.source || d.metadata?.filePath || "";
      let relPath = rawPath;
      if (path.isAbsolute(rawPath)) {
        try {
          const rel = path.relative(absRepo, rawPath);
          if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
            relPath = rel;
          }
        } catch {}
      }
      return {
        file: relPath.replace(/\\/g, "/"),
        startLine: d.metadata?.startLine ?? 1,
        endLine: d.metadata?.endLine ?? 1,
      };
    });
    send("sources", { sources });

    // 4. Stream the LLM answer
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
// GET /file (Fetches raw file content for citation preview)
// ---------------------------------------------------------------------------

app.get("/file", async (req, res) => {
  let { repoPath = "repos/demo", filePath } = req.query;
  if (!filePath || typeof filePath !== "string") {
    return res.status(400).json({ error: "filePath is required" });
  }

  filePath = filePath.trim().replace(/\\/g, "/");

  // If filePath accidentally received just drive letter "C" or invalid prefix
  if (filePath.length <= 2 && /^[a-zA-Z]:?$/.test(filePath)) {
    return res.status(400).json({ error: "Invalid filePath" });
  }

  const safeRepo = resolveRepoDirectory(repoPath);

  // If filePath has repos/<repoName>/ prefix, clean it
  const reposMatch = filePath.match(/(?:^|\/)repos\/[^/]+\/(.*)$/i);
  const cleanRel = reposMatch ? reposMatch[1] : filePath;

  // Candidate paths to check on local disk
  const candidates = [
    path.resolve(safeRepo, cleanRel),
    path.resolve(safeRepo, filePath),
    path.isAbsolute(filePath) ? path.resolve(filePath) : null,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      try {
        const content = fs.readFileSync(candidate, "utf-8");
        return res.json({ content, filePath: cleanRel });
      } catch (err) {
        return res.status(500).json({ error: err.message });
      }
    }
  }

  // 2. Fallback: If local file is missing on disk (e.g. index exists but repo wasn't cloned locally),
  // retrieve the chunk snippet directly from the vector store so preview never fails!
  try {
    const store = await getStore(repoPath);
    const docs = store.getDocs ? store.getDocs() : [];
    const normalizedTarget = cleanRel.toLowerCase();
    const baseTarget = path.basename(cleanRel).toLowerCase();

    const matchingDoc = docs.find(d => {
      const src = (d.metadata?.source || d.metadata?.filePath || "").replace(/\\/g, "/").toLowerCase();
      return src.endsWith(normalizedTarget) || normalizedTarget.endsWith(src) || src.endsWith("/" + baseTarget);
    });

    if (matchingDoc) {
      return res.json({
        content: matchingDoc.pageContent,
        filePath: cleanRel,
        fromIndex: true,
      });
    }
  } catch (storeErr) {
    console.warn("[file fallback store warning]", storeErr.message);
  }

  return res.status(404).json({ error: "File not found" });
});

// ---------------------------------------------------------------------------
// GET /repos (Lists available repos)
// ---------------------------------------------------------------------------

app.get("/repos", (_req, res) => {
  const list = getRegistry();
  res.json({ repos: list });
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.listen(PORT, () => {
  console.log(`\n🚀  Codebase Q&A API running at http://localhost:${PORT}`);
  console.log(`    POST /ingest  { repoPath }`);
  console.log(`    POST /ask     { question, repoPath, topK }`);
  console.log(`    GET  /file    ?repoPath=...&filePath=...`);
  console.log(`    GET  /repos`);
  console.log(`    GET  /health\n`);
});
