/**
 * retriever.js
 *
 * Takes retrieved Document chunks and calls the LLM to produce a cited answer.
 *
 * Phase 3 adds streamAnswer() which returns an async generator of text tokens
 * so the Express server can pipe them to the client via Server-Sent Events.
 *
 * Two exported functions:
 *   generateAnswer(docs, question) → Promise<string>   (used by CLI ask.js)
 *   streamAnswer(docs, question)   → AsyncGenerator      (used by POST /ask)
 */

import { ChatGroq } from "@langchain/groq";

// ---------------------------------------------------------------------------
// Groq LLM setup
// ---------------------------------------------------------------------------

let _llm = null;

function getLLM() {
  if (!_llm) {
    _llm = new ChatGroq({
      // openai/gpt-oss-120b: 120B param model available on the free Groq tier
      model: "openai/gpt-oss-120b",
      maxTokens: 1024,
    });
  }
  return _llm;
}

// ---------------------------------------------------------------------------
// Prompt building
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior software engineer assistant specialising in codebase navigation.

Rules:
1. Answer ONLY from the context provided below. Do not use any outside knowledge.
2. For every claim, cite the source using the format: [file/path.js:L<startLine>-L<endLine>]
3. If multiple chunks support the same point, cite all of them.
4. If the answer is not present in the context, say exactly: "I don't have enough context to answer that question."
5. Keep the answer concise but complete. Use bullet points for multi-part answers.`;

/**
 * Formats retrieved docs into a numbered context block for the prompt.
 */
function buildContext(docs) {
  return docs
    .map((doc, i) => {
      const { source, startLine, endLine } = doc.metadata;
      const lineRange = startLine && endLine ? `L${startLine}-L${endLine}` : "lines unknown";
      return `--- Chunk ${i + 1} [${source}:${lineRange}] ---\n${doc.pageContent}`;
    })
    .join("\n\n");
}

function buildMessages(docs, question) {
  const context = buildContext(docs);
  const userMessage = `Here is the relevant code context:\n\n${context}\n\n---\n\nQuestion: ${question}`;
  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Non-streaming: returns the full answer string.
 * Used by the CLI (ask.js).
 *
 * @param {import("@langchain/core/documents").Document[]} docs
 * @param {string} question
 * @returns {Promise<string>}
 */
export async function generateAnswer(docs, question) {
  const response = await getLLM().invoke(buildMessages(docs, question));
  return response.content;
}

/**
 * Streaming: yields text chunks as they arrive from the LLM.
 * Used by the Express POST /ask endpoint (Server-Sent Events).
 *
 * WHY streaming matters for UX:
 *   A 300-word answer takes ~3 seconds to generate fully before returning.
 *   With streaming, the user sees the first word in ~300ms — the app feels
 *   instant even though total time is the same.
 *
 * @param {import("@langchain/core/documents").Document[]} docs
 * @param {string} question
 * @returns {AsyncGenerator<string>} - yields text tokens one by one
 */
export async function* streamAnswer(docs, question) {
  // .stream() returns an async iterable of AIMessageChunk objects
  const stream = await getLLM().stream(buildMessages(docs, question));

  for await (const chunk of stream) {
    // chunk.content is a string token (could be "", a word, or a sentence fragment)
    if (chunk.content) {
      yield chunk.content;
    }
  }
}
