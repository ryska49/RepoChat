import React, { useState, useEffect, useRef } from "react";
import { Send, Bot, User, Code2, Sparkles, FolderGit2, BookOpen, Layers } from "lucide-react";
import CodeModal from "./components/CodeModal.jsx";

const SUGGESTIONS = [
  "How does user login and signup work?",
  "What routes are available under /api/auth?",
  "How does the protect middleware verify JWT tokens?",
  "What admin capabilities exist for managing deliveries?",
  "How are Express routes registered in server.js?",
];

export default function App() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Hello! I am your Codebase Q&A Assistant. Point me at your repository and ask anything about architecture, endpoints, or middleware. I'll provide grounded answers with exact line citations.",
      sources: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [repoPath, setRepoPath] = useState("repos/demo");
  const [repos, setRepos] = useState(["repos/demo"]);
  const [activeCitation, setActiveCitation] = useState(null);

  const messagesEndRef = useRef(null);

  useEffect(() => {
    fetch("/repos")
      .then((res) => res.json())
      .then((data) => {
        if (data.repos) setRepos(data.repos);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSubmit = async (e, customQuery) => {
    if (e) e.preventDefault();
    const query = customQuery || input;
    if (!query.trim() || isStreaming) return;

    setInput("");
    const userMsgId = Date.now().toString();
    const botMsgId = (Date.now() + 1).toString();

    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: query },
      { id: botMsgId, role: "assistant", content: "", sources: [], streaming: true },
    ]);

    setIsStreaming(true);

    try {
      const response = await fetch("/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: query, repoPath, topK: 10 }),
      });

      if (!response.ok) throw new Error("Failed to connect to assistant API");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop();

        for (const frame of frames) {
          const eventMatch = frame.match(/^event: (\w+)/m);
          const dataMatch = frame.match(/^data: (.+)/m);
          if (!eventMatch || !dataMatch) continue;

          const event = eventMatch[1];
          const data = JSON.parse(dataMatch[1]);

          if (event === "sources") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId ? { ...msg, sources: data.sources } : msg
              )
            );
          } else if (event === "token") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId ? { ...msg, content: msg.content + data.token } : msg
              )
            );
          } else if (event === "done" || event === "error") {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === botMsgId ? { ...msg, streaming: false } : msg
              )
            );
          }
        }
      }
    } catch (err) {
      console.error(err);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === botMsgId
            ? {
                ...msg,
                content: "⚠️ Failed to fetch response. Please ensure `npm run serve` is running.",
                streaming: false,
              }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top Navigation Bar */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.875rem 1.75rem",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--bg-secondary)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              background: "linear-gradient(135deg, #3b82f6, #06b6d4)",
              padding: "0.5rem",
              borderRadius: "8px",
              display: "flex",
            }}
          >
            <Code2 size={20} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: "1rem", fontWeight: 700, letterSpacing: "-0.01em" }}>
              Codebase Q&A Assistant
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.75rem", color: "var(--accent-emerald)" }}>
              <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "var(--accent-emerald)" }}></span>
              Hybrid RAG Ready (BM25 + Dense Vectors)
            </div>
          </div>
        </div>

        {/* Repo Selector */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <FolderGit2 size={16} color="var(--text-secondary)" />
          <select
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            style={{
              background: "var(--bg-tertiary)",
              color: "var(--text-primary)",
              border: "1px solid var(--border-subtle)",
              padding: "0.4rem 0.75rem",
              borderRadius: "6px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8125rem",
              cursor: "pointer",
            }}
          >
            {repos.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
      </header>

      {/* Main Chat Area */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.25rem",
          maxWidth: "960px",
          width: "100%",
          margin: "0 auto",
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              gap: "0.875rem",
              alignItems: "flex-start",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
            }}
          >
            {msg.role === "assistant" && (
              <div
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  padding: "0.5rem",
                  display: "flex",
                  color: "var(--accent-cyan)",
                }}
              >
                <Bot size={18} />
              </div>
            )}

            <div
              className="glass-panel"
              style={{
                maxWidth: "80%",
                padding: "1rem 1.25rem",
                borderRadius: "12px",
                background:
                  msg.role === "user"
                    ? "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(6, 182, 212, 0.2))"
                    : "var(--bg-secondary)",
                borderColor: msg.role === "user" ? "rgba(59, 130, 246, 0.4)" : "var(--border-subtle)",
              }}
            >
              {/* Message Content */}
              <div style={{ fontSize: "0.9375rem", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                {msg.content || (msg.streaming ? "Searching codebase & thinking..." : "")}
              </div>

              {/* Citations row */}
              {msg.sources && msg.sources.length > 0 && (
                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-subtle)" }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      fontSize: "0.75rem",
                      color: "var(--text-muted)",
                      marginBottom: "0.5rem",
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    <BookOpen size={12} /> Cited Sources ({msg.sources.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                    {msg.sources.map((src, i) => (
                      <button
                        key={i}
                        onClick={() => setActiveCitation(src)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.35rem",
                          background: "var(--bg-tertiary)",
                          border: "1px solid var(--border-subtle)",
                          padding: "0.25rem 0.55rem",
                          borderRadius: "6px",
                          color: "var(--accent-cyan)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.75rem",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--accent-blue)";
                          e.currentTarget.style.background = "rgba(59, 130, 246, 0.15)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--border-subtle)";
                          e.currentTarget.style.background = "var(--bg-tertiary)";
                        }}
                      >
                        <Layers size={11} />
                        {src.file}
                        {src.startLine && `:L${src.startLine}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {msg.role === "user" && (
              <div
                style={{
                  background: "var(--bg-tertiary)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "8px",
                  padding: "0.5rem",
                  display: "flex",
                  color: "var(--accent-blue)",
                }}
              >
                <User size={18} />
              </div>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Suggested Questions */}
      <div style={{ maxWidth: "960px", width: "100%", margin: "0 auto", padding: "0 1.5rem" }}>
        <div style={{ display: "flex", gap: "0.5rem", overflowX: "auto", paddingBottom: "0.5rem" }}>
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={idx}
              disabled={isStreaming}
              onClick={() => handleSubmit(null, s)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.35rem 0.75rem",
                borderRadius: "9999px",
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-secondary)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
                cursor: "pointer",
              }}
            >
              <Sparkles size={12} color="var(--accent-amber)" />
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          background: "var(--bg-secondary)",
          padding: "1rem 1.5rem",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            maxWidth: "960px",
            margin: "0 auto",
            display: "flex",
            gap: "0.75rem",
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question about authentication, controllers, database models..."
            disabled={isStreaming}
            style={{
              flex: 1,
              background: "var(--bg-primary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "0.9375rem",
              fontFamily: "inherit",
              outline: "none",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--border-focus)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border-subtle)")}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              padding: "0.75rem 1.5rem",
              borderRadius: "8px",
              border: "none",
              background: isStreaming || !input.trim() ? "var(--bg-tertiary)" : "var(--accent-blue)",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.875rem",
              cursor: isStreaming || !input.trim() ? "not-allowed" : "pointer",
              transition: "background 0.2s ease",
            }}
          >
            <Send size={16} />
            Send
          </button>
        </form>
      </footer>

      {/* Interactive Code Modal */}
      {activeCitation && (
        <CodeModal
          citation={activeCitation}
          repoPath={repoPath}
          onClose={() => setActiveCitation(null)}
        />
      )}
    </div>
  );
}
