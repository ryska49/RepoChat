/**
 * test-stream.js — verifies the POST /ask SSE stream end-to-end
 * Run: node src/server/test-stream.js
 */
import "dotenv/config";

const body = JSON.stringify({
  question: "How does JWT token generation work?",
  repoPath: "repos/demo",
  topK: 10,
});

const res = await fetch("http://localhost:3001/ask", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body,
});

const reader = res.body.getReader();
const decoder = new TextDecoder();
let buffer = "";
let answer = "";

console.log("\n📡  Streaming response from POST /ask…\n");

while (true) {
  const { value, done } = await reader.read();
  if (done) break;

  buffer += decoder.decode(value, { stream: true });
  const frames = buffer.split("\n\n");
  buffer = frames.pop(); // keep incomplete frame in buffer

  for (const frame of frames) {
    // Each SSE frame looks like:  "event: token\ndata: {"token":"Hello"}"
    const eventMatch = frame.match(/^event: (\w+)/m);
    const dataMatch  = frame.match(/^data: (.+)/m);
    if (!eventMatch || !dataMatch) continue;

    const event = eventMatch[1];
    const data  = JSON.parse(dataMatch[1]);

    if (event === "sources") {
      console.log("📎  Sources retrieved:");
      for (const s of data.sources) {
        const rel = s.file.split("repos/demo/")[1] ?? s.file;
        console.log(`  • ${rel}:L${s.startLine}-L${s.endLine}`);
      }
      console.log("\n🤖  Answer:\n");
    } else if (event === "token") {
      process.stdout.write(data.token); // stream tokens to terminal in real-time
      answer += data.token;
    } else if (event === "done") {
      console.log("\n\n✅  Stream complete");
    } else if (event === "error") {
      console.error("\n❌  Server error:", data.error);
    }
  }
}
