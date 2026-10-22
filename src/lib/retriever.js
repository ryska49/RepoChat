/**
 * retriever.js
 *
 * Takes a list of retrieved Document chunks and calls the LLM to produce a
 * cited answer.
 *
 * Key design decisions:
 *   1. We format the context ourselves (not via a LangChain chain) so you can
 *      see exactly what goes into the prompt — no magic.
 *   2. The system prompt hard-codes "only answer from context" to reduce
 *      hallucinations. The model is instructed to say "I don't know" when
 *      the answer isn't in the retrieved chunks.
 *   3. Each chunk is labelled with its file path and line range so the LLM
 *      can cite them inline.
 *
 * LLM: Groq (free tier) — get your key at https://console.groq.com
 */

import { ChatGroq } from "@langchain/groq";

// ---------------------------------------------------------------------------
// Groq setup (free — no credit card needed)
// ---------------------------------------------------------------------------

let _llm = null;

function getLLM() {
  if (!_llm) {
    _llm = new ChatGroq({
      // openai/gpt-oss-120b: 120B parameter model available on your Groq account
      // apiKey is read automatically from process.env.GROQ_API_KEY
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
 * Each block shows the file path, line range, and the chunk text.
 */
function buildContext(docs) {
  return docs
    .map((doc, i) => {
      const { source, startLine, endLine } = doc.metadata;
      const lineRange =
        startLine && endLine ? `L${startLine}-L${endLine}` : "lines unknown";
      return `--- Chunk ${i + 1} [${source}:${lineRange}] ---\n${doc.pageContent}`;
    })
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Calls Claude with the retrieved context and returns the answer string.
 *
 * @param {import("@langchain/core/documents").Document[]} docs - Retrieved chunks
 * @param {string} question - The user's question
 * @returns {Promise<string>}
 */
export async function generateAnswer(docs, question) {
  const context = buildContext(docs);

  const userMessage = `Here is the relevant code context:\n\n${context}\n\n---\n\nQuestion: ${question}`;

  const llm = getLLM();
  const response = await llm.invoke([
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userMessage },
  ]);

  return response.content;
}
