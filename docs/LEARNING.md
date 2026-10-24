# Codebase Q&A Assistant — Learning Notes

> These notes grow one section per phase. Written for someone new to RAG and LangChain.js.

---

## Phase 1 — Terminal Prototype

### What is RAG?

**Retrieval-Augmented Generation** is a pattern for making LLMs answer questions about data they were never trained on (like your private codebase). Instead of fine-tuning the model (expensive, slow), you:

1. Pre-process your data into searchable chunks stored in a **vector store**
2. At query time, **retrieve** the most relevant chunks
3. Stuff them into the LLM's prompt as context and ask it to answer **only from that context**

This is cheaper, faster to update (just re-ingest), and more trustworthy (the model must cite sources).

---

### Key Terms

| Term | Plain-English Definition |
|---|---|
| **Embedding** | A list of numbers (a vector) that represents the *meaning* of a piece of text. Similar texts → similar vectors. Produced by a small, fast model. |
| **Vector store** | A database that stores vectors and can answer "find me the N vectors closest to this query vector" efficiently. |
| **Cosine similarity** | The way we measure "closeness" of two vectors. It measures the angle between them, not their length. Two texts with the same meaning → angle ≈ 0° → similarity ≈ 1.0. |
| **Chunk** | A small piece of a source file (e.g. 1000 characters). We embed chunks, not whole files, because LLM context windows are limited and smaller units are more focused. |
| **Chunk overlap** | Each chunk repeats the last N characters of the previous chunk. This prevents a concept that straddles a boundary from being split in half. |
| **Document** | LangChain's name for a chunk + its metadata (file path, line numbers, language). |
| **RecursiveCharacterTextSplitter** | A splitter that tries a list of separators in priority order (e.g. blank line → function keyword → arbitrary character). Language-specific variants know the right separators for JS, Python, etc. |
| **MemoryVectorStore** | A simple in-memory vector store (an array of [vector, document] pairs with brute-force cosine search). Zero setup, wiped on restart. |
| **System prompt** | Instructions given to the LLM before the user's message. Here we use it to enforce citation format and prevent hallucinations. |

---

### Why Each Design Choice Was Made

**`type: "module"` in package.json**
LangChain.js is published as ES modules (using `import`/`export`). You must tell Node.js you're writing ESM too, otherwise `import` syntax throws a SyntaxError.

**`@langchain/textsplitters` (not `langchain/text_splitter`)**
LangChain.js split into multiple scoped packages in v0.2+. Each capability lives in its own package. Always check the current docs — import paths change between major versions.

**Local embeddings (`all-MiniLM-L6-v2`) instead of an API**
Anthropic (Claude's maker) doesn't offer an embeddings API. Options are: OpenAI embeddings (paid, data leaves machine), Cohere embeddings (paid), or a local model via `@huggingface/transformers`. We chose local for cost and privacy. The model is 22 MB, downloads once, and runs in Node via ONNX Runtime.

**`chunkSize: 1000, chunkOverlap: 150`**
- 1000 characters ≈ 15–30 lines of code — enough for a function body to be self-contained.
- 150 character overlap ensures context at boundaries (e.g. a function signature that appears at the end of one chunk is repeated at the start of the next).
- These are starting values. Phase 2's eval script will tell us whether they're optimal.

**"Answer only from context" system prompt**
Without this constraint, Claude will blend its training knowledge with retrieved context — making it impossible to know if an answer came from *your* repo or Claude's memory. Hard constraints give reproducible, auditable answers.

**Single-responsibility modules in `src/lib/`**
Each file does one thing: `loader.js` walks files, `splitter.js` chunks them, `embedder.js` vectorises, `vectorStore.js` stores/retrieves, `retriever.js` generates the answer. This makes Phase 3's swap from `MemoryVectorStore` → Chroma a one-file change.

---

### The Pipeline at a Glance

```

---

## Phase 2 — Evaluation Set

### Why Measure Retrieval, Not Answer Quality?

Answer quality requires a human to read every response and judge it — that doesn't scale. **Retrieval hit rate** is automatic and objective: for each question, did the file containing the real answer appear in the top-k chunks returned by the vector store?

If the right file **is** retrieved → the LLM almost always answers correctly.
If the right file **isn't** retrieved → no prompt or model can fix it; it was never in the context.

This makes retrieval hit rate the single most actionable metric at this stage.

### Key Terms

| Term | Definition |
|---|---|
| **Hit** | The expected file appears at least once in the top-k retrieved chunks |
| **Miss** | The expected file does not appear in top-k — the LLM will say "I don't know" |
| **Hit rate** | hits / total questions × 100% |
| **Recall curve** | Hit rate measured at different k values (k=5, 10, 20) — shows how much improvement you get by retrieving more chunks |
| **Baseline** | The score before any improvements — used to prove future changes helped |

### Baseline Scores (Phase 2, pure vector search)

| k | Hit Rate |
|---|---|
| 5  | **76%** (13/17) |
| 10 | **82%** (14/17) |
| 20 | **88%** (15/17) |

### What the Misses Tell Us

All 4 misses at k=5 share the same pattern: the **route file** (e.g. `authRoutes.js`) is beaten by the **controller file** (e.g. `authController.js`).

Why? The controller is much longer and contains more meaningful words. The embedding model finds it more semantically similar to questions like "what routes are available?". The route file is tiny (11 lines, just `router.post(...)` declarations) and lacks prose that matches the question.

**This is the exact problem hybrid search (Phase 4) fixes.** BM25 keyword search finds `authRoutes.js` by matching the word "auth" in the filename — something semantic vectors can't do.
Repo folder
    │
    ▼
loader.js          Walk files, filter extensions, read text
    │  { filePath, content }[]
    ▼
splitter.js        RecursiveCharacterTextSplitter.fromLanguage()
    │  Document[]  (pageContent + metadata: source, startLine, endLine)
    ▼
embedder.js        HuggingFaceTransformersEmbeddings (local, 384-dim)
    │  float32[][]
    ▼
vectorStore.js     MemoryVectorStore.fromDocuments()
    │  (stored in RAM)
    │
    │  ← user question arrives
    ▼
vectorStore.js     similaritySearch(question, k=5)  →  top 5 Documents
    ▼
retriever.js       Build context block, call Claude, return cited answer
    ▼
stdout
```

---

## Phase 2 — Evaluation Set

### Why Measure Retrieval, Not Answer Quality?

Answer quality requires a human to read every response and judge it — that doesn't scale. **Retrieval hit rate** is automatic and objective: for each question, did the file containing the real answer appear in the top-k chunks returned by the vector store?

If the right file **is** retrieved → the LLM almost always answers correctly.
If the right file **isn't** retrieved → no prompt or model can fix it; it was never in the context.

This makes retrieval hit rate the single most actionable metric at this stage.

### Key Terms

| Term | Definition |
|---|---|
| **Hit** | The expected file appears at least once in the top-k retrieved chunks |
| **Miss** | The expected file does not appear in top-k — the LLM will say "I don't know" |
| **Hit rate** | hits / total questions × 100% |
| **Recall curve** | Hit rate measured at different k values (k=5, 10, 20) — shows how much improvement you get by retrieving more chunks |
| **Baseline** | The score before any improvements — used to prove future changes helped |

### Baseline Scores (Phase 2, pure vector search)

| k | Hit Rate |
|---|---|
| 5  | **76%** (13/17) |
| 10 | **82%** (14/17) |
| 20 | **88%** (15/17) |

### What the Misses Tell Us

All 4 misses at k=5 share the same pattern: the **route file** (e.g. `authRoutes.js`) is beaten by the **controller file** (e.g. `authController.js`).

Why? The controller is much longer and contains more meaningful words. The embedding model finds it more semantically similar to questions like "what routes are available?". The route file is tiny (11 lines, just `router.post(...)` declarations) and lacks prose that matches the question.

**This is the exact problem hybrid search (Phase 4) fixes.** BM25 keyword search finds `authRoutes.js` by matching the word "auth" in the filename — something semantic vectors can't do.


---

## Phase 3 — Persistence and API

### Why Persistence Matters

Every time `ask.js` runs, it re-reads 23 files, splits them into 68 chunks, and runs each through the embedding model. That takes 30+ seconds. With persistence we serialize the vectors (just numbers) and document metadata to a JSON file. Next run: read the file, skip embedding, start in under 1 second.

**What gets saved:** `{ entries: [{ vector: float[], doc: { pageContent, metadata } }] }`  
**What doesn't get saved:** the embedding model itself (we re-load it on demand from HuggingFace cache)

### Key Terms

| Term | Definition |
|---|---|
| **SSE (Server-Sent Events)** | A simple HTTP protocol for server-to-client streaming. The server sends `data: ...\n\n` frames and keeps the connection open. The client reads them as they arrive. One-directional (server → client only). |
| **async generator** | A JavaScript function that `yield`s values over time using `async function*`. LangChain's `.stream()` returns one — we iterate it with `for await (const chunk of stream)`. |
| **chunked transfer encoding** | The HTTP mechanism that lets a server send a response in pieces. SSE uses this under the hood. |
| **store cache (Map)** | The server keeps a `Map<repoPath, store>` so the second request to the same repo doesn't even read disk — the store is already in memory. |

### The Two-Layer Cache

```
Request for repoPath
        │
        ▼
Is it in storeCache (RAM)?  ──yes──▶  return immediately (fastest)
        │ no
        ▼
Is there a .index/<name>.json?  ──yes──▶  load from disk + cache in RAM
        │ no
        ▼
Full ingest: walk → split → embed → save to disk → cache in RAM
```

### Why SSE Over WebSockets?

| | SSE | WebSocket |
|---|---|---|
| Direction | Server → Client only | Bidirectional |
| Setup | Plain HTTP | Handshake upgrade |
| Proxy/firewall friendly | ✅ Yes | ⚠️ Sometimes blocked |
| Use case | Streaming LLM answers | Chat, games, live collab |

For streaming a read-only LLM answer, SSE is simpler and sufficient.

### SSE Event Types We Send

```
event: sources   ← file citations (emitted first, before answer starts)
event: token     ← one text fragment from the LLM
event: done      ← stream complete
event: error     ← something went wrong
```

Sending `sources` first means the UI can render citation chips immediately while the answer is still streaming — a nice UX trick.
