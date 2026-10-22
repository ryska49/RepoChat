/**
 * splitter.js
 *
 * Takes the raw file objects from loader.js and splits them into LangChain
 * Document objects.  Each Document gets metadata that will survive into the
 * vector store and appear in citations:
 *   - source  : absolute file path
 *   - language: detected language string (for the code-aware splitter)
 *   - startLine / endLine: approximate line range of this chunk
 *
 * WHY RecursiveCharacterTextSplitter.fromLanguage?
 *   A generic character splitter cuts through function bodies mid-line, making
 *   chunks hard to understand in isolation.  The language-aware variant uses a
 *   priority-ordered list of "natural break points" (blank lines, function
 *   declarations, class boundaries) so chunks are more self-contained.
 */

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

/**
 * Maps file extension -> language string understood by
 * RecursiveCharacterTextSplitter.fromLanguage().
 * Falls back to "markdown" for unknown types (decent generic separators).
 */
const EXT_TO_LANGUAGE = {
  ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js",
  ".ts": "js", ".tsx": "js", ".mts": "js", // TS uses JS separators
  ".py": "python",
  ".html": "html",
  ".css": "markdown", // no CSS support; markdown separators are fine
  ".md": "markdown", ".mdx": "markdown",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".cpp": "cpp", ".c": "cpp", ".h": "cpp", ".hpp": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".sol": "sol",
};

function detectLanguage(filePath) {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return EXT_TO_LANGUAGE[ext] ?? "markdown";
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Splits an array of { filePath, content } objects into LangChain Documents.
 *
 * @param {{ filePath: string, content: string }[]} files
 * @param {{ chunkSize?: number, chunkOverlap?: number }} options
 * @returns {Promise<import("@langchain/core/documents").Document[]>}
 */
export async function splitFiles(files, { chunkSize = 1000, chunkOverlap = 150 } = {}) {
  const allDocs = [];

  for (const { filePath, content } of files) {
    const language = detectLanguage(filePath);

    const splitter = RecursiveCharacterTextSplitter.fromLanguage(language, {
      chunkSize,
      chunkOverlap,
    });

    // createDocuments() accepts parallel arrays of [texts] and [metadatas].
    // We pass a single file at a time so the metadata is per-file-accurate.
    const docs = await splitter.createDocuments(
      [content],
      [{ source: filePath, language }]
    ); 

    // Attach approximate line numbers to each chunk.
    // We count newlines up to each chunk's character offset in the file.
    annotateLineNumbers(docs, content, filePath);

    allDocs.push(...docs);
  }

  return allDocs;
}

// ---------------------------------------------------------------------------
// Line number annotation
// ---------------------------------------------------------------------------

/**
 * LangChain's splitter doesn't tell us which lines a chunk came from.
 * We reconstruct this by scanning for the chunk's text inside the original
 * file content (first occurrence) and counting newlines before/after it.
 *
 * This is approximate — duplicate code blocks may map to the wrong occurrence
 * — but it's good enough for citations in a RAG context.
 */
function annotateLineNumbers(docs, fileContent, filePath) {
  // Pre-build a newline index: newlines[i] = char-offset of the i-th '\n'
  const newlineOffsets = [];
  for (let i = 0; i < fileContent.length; i++) {
    if (fileContent[i] === "\n") newlineOffsets.push(i);
  }

  /** Given a char offset, return the 1-based line number. */
  const charToLine = (offset) => {
    // Binary search for the number of newlines before `offset`
    let lo = 0, hi = newlineOffsets.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (newlineOffsets[mid] < offset) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1; // 1-based
  }; 
  let searchStart = 0; // walk forward to handle duplicates reasonably

  for (const doc of docs) {
    const chunkText = doc.pageContent;
    const idx = fileContent.indexOf(chunkText, searchStart);

    if (idx === -1) {
      // Chunk wasn't found verbatim (can happen with whitespace normalisation)
      doc.metadata.startLine = null;
      doc.metadata.endLine = null;
    } else {
      doc.metadata.startLine = charToLine(idx);
      doc.metadata.endLine = charToLine(idx + chunkText.length - 1);
      // Advance searchStart so the next chunk searches from here
      searchStart = idx + 1;
    }

    // Keep the filePath duplicated in a short key for easy destructuring later
    doc.metadata.filePath = filePath;
  }
}
