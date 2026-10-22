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
