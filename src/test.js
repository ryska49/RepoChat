/**
 * test.js: tests each module independently.
 *
 * Usage:
 *   node src/test.js            # run everything
 *   node src/test.js loader     # loader | splitter | embedder | store | generate | ingest
 */
import "dotenv/config";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Document } from "@langchain/core/documents";

// ---------------------------------------------------------------------------
// Fixture: a tiny fake repo in a temp folder, so tests don't depend on a real repo
// ---------------------------------------------------------------------------
function makeFixtureRepo() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "code-rag-"));
    const write = (rel, content) => {
        const full = path.join(root, rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content);
    };

    // Many small functions so the file is large enough to produce several chunks
    const authFns = Array.from({ length: 30 }, (_, i) =>
        `function checkPermission${i}(user) {\n  // verify the user's login token and role\n  return user.roles.includes("role${i}");\n}\n`
    ).join("\n");

    write("src/auth.js", `import jwt from "jsonwebtoken";\n\nexport function verifyToken(token) {\n  return jwt.verify(token, process.env.SECRET);\n}\n\n${authFns}`);
    write("src/math.py", `def add(a, b):\n    return a + b\n\ndef mul(a, b):\n    return a * b\n`);
    write("src/Program.cs", `class Program { static void Main() { System.Console.WriteLine("hi"); } }\n`); // unsupported-language check
    write("README.md", `# Demo\n\nA tiny demo repo.\n`);

    // Things the loader must SKIP
    write("node_modules/junk/index.js", `module.exports = 1;\n`);
    write("package-lock.json", `{}\n`);
    write("logo.png", "not really an image");
    write("src/huge.js", "a".repeat(600_000));

    return root;
}

const cosine = (a, b) => {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] ** 2; nb += b[i] ** 2; }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
};

let FIXTURE;

// ---------------------------------------------------------------------------
// Tests (each one imports only the module it tests)
// ---------------------------------------------------------------------------
const tests = {
    async loader() {
        const { loadRepoFiles } = await import("./lib/loader.js");
        const files = loadRepoFiles(FIXTURE);
        const names = files.map(f => path.relative(FIXTURE, f.filePath).replaceAll("\\", "/"));
        console.log("   loaded:", names);

        for (const keep of ["src/auth.js", "src/math.py", "README.md"])
            assert.ok(names.includes(keep), `should include ${keep}`);

        assert.ok(!names.some(n => n.includes("node_modules")), "should skip node_modules");
        assert.ok(!names.includes("package-lock.json"), "should skip lock files");
        assert.ok(!names.includes("logo.png"), "should skip non-whitelisted extensions");
        assert.ok(!names.includes("src/huge.js"), "should skip files over 500 KB");
        assert.ok(files.every(f => typeof f.content === "string" && f.content.length > 0));
    },

    async splitter() {
        const { loadRepoFiles } = await import("./lib/loader.js");
        const { splitFiles } = await import("./lib/splitter.js");
        const files = loadRepoFiles(FIXTURE);
        const docs = await splitFiles(files); // also checks the .cs file doesn't crash it

        console.log(`   ${docs.length} chunks. Sample metadata:`, docs[0].metadata);
        assert.ok(docs.length > files.length, "auth.js should split into multiple chunks");

        for (const d of docs) {
            assert.ok(d.pageContent.length > 0, "chunk has text");
            assert.ok(d.pageContent.length <= 1200, `chunk too big: ${d.pageContent.length}`);
            assert.ok(d.metadata.source, "chunk has source");
            assert.ok(d.metadata.language, "chunk has language");
        }

        const authDocs = docs.filter(d => d.metadata.source.endsWith("auth.js"));
        assert.ok(authDocs.some(d => typeof d.metadata.startLine === "number"), "line numbers set");

        // Verify line numbers against the real file
        const lines = fs.readFileSync(authDocs[0].metadata.source, "utf8").split("\n");
        const { startLine } = authDocs[1].metadata;
        const firstLineOfChunk = authDocs[1].pageContent.split("\n")[0];
        assert.equal(lines[startLine - 1], firstLineOfChunk, "startLine should point at the chunk's first line");
    },

    async embedder() {
        const { getEmbeddings } = await import("./lib/embedder.js");
        const emb = getEmbeddings();
        const [login, auth, bread] = await emb.embedDocuments([
            "user login", "authentication of a user", "banana bread recipe",
        ]);
        console.log("   vector length:", login.length);
        assert.ok(Array.isArray(login) && login.length > 0, "returns a vector");
        assert.ok(login.every(Number.isFinite), "vector contains numbers");

        const related = cosine(login, auth), unrelated = cosine(login, bread);
        console.log(`   similarity related=${related.toFixed(3)} unrelated=${unrelated.toFixed(3)}`);
        assert.ok(related > unrelated, "related texts should be closer than unrelated ones");

        const q = await emb.embedQuery("user login");
        assert.equal(q.length, login.length, "query and document vectors have the same size");
    },

    async store() {
        const { getEmbeddings } = await import("./lib/embedder.js");
        const { buildVectorStore, retrieve } = await import("./lib/vectorStore.js");
        const docs = [
            new Document({ pageContent: "function verifyToken(token) { return jwt.verify(token, SECRET); } // checks the user's login token", metadata: { source: "src/auth.js", startLine: 1, endLine: 3 } }),
            new Document({ pageContent: "const pool = new Pool({ host, port }); // database connection setup", metadata: { source: "src/db.js", startLine: 1, endLine: 2 } }),
            new Document({ pageContent: "function Button() { return <button>Click</button>; } // React UI component", metadata: { source: "src/Button.jsx", startLine: 1, endLine: 2 } }),
        ];
        const store = await buildVectorStore(docs, getEmbeddings());
        const hits = await retrieve(store, "where is login authentication handled?", 2);
        console.log("   top hits:", hits.map(h => h.metadata.source));

        assert.equal(hits.length, 2, "returns k results");
        assert.equal(hits[0].metadata.source, "src/auth.js", "auth chunk should rank first");
        assert.ok(hits[0].metadata.startLine === 1, "metadata survives retrieval");
    },

    async generate() {
        if (!process.env.ANTHROPIC_API_KEY) {
            console.log("   ⚠️  ANTHROPIC_API_KEY not set, skipping");
            return;
        }
        const { generateAnswer } = await import("./lib/retriever.js");
        const docs = [
            new Document({ pageContent: "export function verifyToken(token) {\n  return jwt.verify(token, process.env.SECRET);\n}", metadata: { source: "src/auth.js", startLine: 3, endLine: 5 } }),
        ];

        const answer = await generateAnswer(docs, "How are tokens verified?");
        console.log("   answer:", String(answer).slice(0, 200).replace(/\n/g, " "), "…");
        assert.equal(typeof answer, "string", "answer should be a string");
        assert.ok(answer.length > 20, "answer is not empty");
        assert.ok(answer.includes("auth.js"), "answer should cite the file path");

        // Soft check: with irrelevant context, the model should admit it doesn't know
        const idk = await generateAnswer(docs, "What is the capital of France?");
        console.log("   off-topic answer:", String(idk).slice(0, 150).replace(/\n/g, " "));
        if (!/know|not (in|found|provided|contain)|no information|cannot|can't/i.test(idk))
            console.log("   ⚠️  model may not be refusing off-topic questions; review your system prompt");
    },

    async ingest() {
        const { ingestRepo } = await import("./ingest.js");
        const { retrieve } = await import("./lib/vectorStore.js");
        const store = await ingestRepo(FIXTURE);
        const hits = await retrieve(store, "verify the login token", 3);
        console.log("   top hits:", hits.map(h => `${path.basename(h.metadata.source)}:${h.metadata.startLine}`));
        assert.ok(hits.length > 0, "retrieves something");
        assert.ok(hits.some(h => h.metadata.source.endsWith("auth.js")), "auth.js should be among the top hits");
    },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
const which = process.argv[2] ?? "all";
const names = which === "all" ? Object.keys(tests) : [which];
if (names.some(n => !tests[n])) {
    console.error(`Unknown test "${which}". Options: ${Object.keys(tests).join(", ")}, all`);
    process.exit(1);
}

FIXTURE = makeFixtureRepo();
let failed = 0;

for (const name of names) {
    console.log(`\n▶ ${name}`);
    try {
        await tests[name]();
        console.log(`✅ ${name} passed`);
    } catch (err) {
        failed++;
        console.log(`❌ ${name} failed: ${err.message}`);
        if (!(err instanceof assert.AssertionError)) console.log(err.stack);
    }
}

fs.rmSync(FIXTURE, { recursive: true, force: true });
console.log(`\n${failed ? "❌" : "✅"} ${names.length - failed}/${names.length} passed`);
process.exit(failed ? 1 : 0);