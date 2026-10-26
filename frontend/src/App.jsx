import React, { useState, useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  Send,
  Terminal,
  FolderGit2,
  FileCode2,
  ArrowRight,
  ExternalLink,
  Sparkles,
  Layers,
  Plus,
} from "lucide-react";
import CodeModal from "./components/CodeModal.jsx";
import AddRepoModal from "./components/AddRepoModal.jsx";

const SUGGESTIONS = [
  "What does this repository do?",
  "How does user login and signup work?",
  "What routes are available under /api/auth?",
  "How does the protect middleware verify JWT tokens?",
  "What admin capabilities exist for managing deliveries?",
];

export default function App() {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      role: "assistant",
      content:
        "### Welcome\nAsk any question about your codebase architecture, routes, middleware, or models. Answers are grounded in the repository with clickable line citations.",
      sources: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [repoPath, setRepoPath] = useState("demo");
  const [repos, setRepos] = useState([
    { id: "demo", name: "demo", path: "repos/demo", chunkCount: 68 },
  ]);
  const [activeCitation, setActiveCitation] = useState(null);
  const [showAddModal, setShowAddModal] = useState(false);

  const messagesEndRef = useRef(null);

  const fetchRepos = () => {
    fetch("/repos")
      .then((res) => res.json())
      .then((data) => {
        if (data.repos && data.repos.length > 0) {
          setRepos(data.repos);
          // If current repoPath is not in the list, set to the first one
          if (!data.repos.some((r) => (r.id || r.path || r) === repoPath)) {
            const first = data.repos[0];
            setRepoPath(first.id || first.path || first);
          }
        }
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetchRepos();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleCitationClick = (param) => {
    if (!param) return;

    // 1. Direct object passed from sources chips: { file, startLine, endLine }
    if (typeof param === "object" && param.file) {
      let filePart = param.file.replace(/\\/g, "/");
      const reposMatch = filePart.match(/(?:^|\/)repos\/[^/]+\/(.*)$/i);
      if (reposMatch) filePart = reposMatch[1];

      setActiveCitation({
        file: filePart,
        startLine: param.startLine || null,
        endLine: param.endLine || null,
      });
      return;
    }

    // 2. Raw string citation from markdown: e.g. "[backend/src/routes/authRoutes.js:L1-L11]"
    let cleaned = String(param).replace(/^\[|\]$/g, "").trim();
    let filePart = cleaned;
    let startLine = null;
    let endLine = null;

    // Match line range from the end of the string (e.g. :L1-L11, :1-11, :L5)
    // Never split by ':' because Windows paths start with drive letter 'C:'!
    const lineMatch = cleaned.match(/:L?(\d+)(?:-L?(\d+))?\s*$/i);
    if (lineMatch) {
      startLine = parseInt(lineMatch[1], 10);
      endLine = lineMatch[2] ? parseInt(lineMatch[2], 10) : startLine;
      filePart = cleaned.slice(0, lineMatch.index).trim();
    }

    filePart = filePart.replace(/\\/g, "/");
    const reposMatch = filePart.match(/(?:^|\/)repos\/[^/]+\/(.*)$/i);
    if (reposMatch) {
      filePart = reposMatch[1];
    }

    setActiveCitation({
      file: filePart,
      startLine,
      endLine,
    });
  };

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

      if (!response.ok) throw new Error("Failed to connect to API");

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
                content: "⚠️ Failed to fetch response. Make sure `npm run serve` is running.",
                streaming: false,
              }
            : msg
        )
      );
    } finally {
      setIsStreaming(false);
    }
  };

  // Custom text renderer to transform inline citations into interactive badges
  const renderFormattedContent = (content) => {
    // Match [path/to/file.ext:L1-L2] pattern (supports forward/backward slashes and optional drive letters)
    const citationRegex = /(\[[^\]\r\n]+\.[a-zA-Z0-9]+(?::L?\d+(?:-L?\d+)?)?\])/g;

    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => {
            const processedChildren = React.Children.map(children, (child) => {
              if (typeof child !== "string") return child;
              const parts = child.split(citationRegex);
              return parts.map((part, index) => {
                if (citationRegex.test(part)) {
                  return (
                    <button
                      key={index}
                      onClick={() => handleCitationClick(part)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.25rem",
                        padding: "0.1rem 0.45rem",
                        margin: "0 0.2rem",
                        borderRadius: "4px",
                        border: "1px solid var(--border-subtle)",
                        background: "var(--code-bg)",
                        color: "var(--accent-cyan)",
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.75rem",
                        cursor: "pointer",
                        verticalAlign: "baseline",
                        transition: "all 0.15s ease",
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = "var(--accent-primary)";
                        e.currentTarget.style.background = "var(--accent-muted)";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "var(--border-subtle)";
                        e.currentTarget.style.background = "var(--code-bg)";
                      }}
                    >
                      <FileCode2 size={11} />
                      {part.replace(/^\[|\]$/g, "")}
                    </button>
                  );
                }
                return part;
              });
            });
            return <p>{processedChildren}</p>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", backgroundColor: "var(--bg-app)" }}>
      {/* Top Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.75rem 1.5rem",
          borderBottom: "1px solid var(--border-subtle)",
          backgroundColor: "var(--bg-surface)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "6px",
              backgroundColor: "var(--bg-card)",
              border: "1px solid var(--border-subtle)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-primary)",
            }}
          >
            <Terminal size={15} />
          </div>
          <div>
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Codebase Assistant
            </span>
          </div>
        </div>

        {/* Repository selector & Add Repo button */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <FolderGit2 size={14} color="var(--text-muted)" />
          <select
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            style={{
              backgroundColor: "var(--bg-card)",
              color: "var(--text-secondary)",
              border: "1px solid var(--border-subtle)",
              padding: "0.35rem 0.65rem",
              borderRadius: "6px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.75rem",
              cursor: "pointer",
              outline: "none",
            }}
          >
            {repos.map((r) => {
              const val = typeof r === "string" ? r : (r.id || r.path || r.name);
              const label = typeof r === "string" ? r : `${r.name || r.id}${r.chunkCount ? ` (${r.chunkCount} chunks)` : ""}`;
              return (
                <option key={val} value={val}>
                  {label}
                </option>
              );
            })}
          </select>

          <button
            onClick={() => setShowAddModal(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.3rem",
              padding: "0.35rem 0.65rem",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: "var(--bg-card)",
              color: "var(--text-secondary)",
              fontFamily: "var(--font-sans)",
              fontSize: "0.75rem",
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-subtle)";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <Plus size={13} color="var(--accent-primary)" />
            <span>Add Repo</span>
          </button>
        </div>
      </header>

      {/* Messages Scroll Area */}
      <main
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "1.5rem",
          display: "flex",
          flexDirection: "column",
          gap: "1.5rem",
          maxWidth: "880px",
          width: "100%",
          margin: "0 auto",
        }}
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: msg.role === "user" ? "flex-end" : "flex-start",
              width: "100%",
            }}
          >
            <div
              style={{
                fontSize: "0.6875rem",
                fontFamily: "var(--font-mono)",
                color: "var(--text-muted)",
                marginBottom: "0.35rem",
                paddingLeft: msg.role === "user" ? 0 : "0.25rem",
                paddingRight: msg.role === "user" ? "0.25rem" : 0,
              }}
            >
              {msg.role === "user" ? "You" : "Assistant"}
            </div>

            <div
              style={{
                maxWidth: msg.role === "user" ? "80%" : "100%",
                padding: msg.role === "user" ? "0.75rem 1rem" : "1.25rem 1.5rem",
                borderRadius: "8px",
                backgroundColor: msg.role === "user" ? "#1d283a" : "var(--bg-surface)",
                border: "1px solid",
                borderColor: msg.role === "user" ? "rgba(59, 130, 246, 0.4)" : "var(--border-subtle)",
                color: "var(--text-primary)",
              }}
            >
              {/* Formatted Markdown Body */}
              <div className="markdown-body">
                {msg.content ? (
                  renderFormattedContent(msg.content)
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                    <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--accent-primary)", animation: "pulse 1.5s infinite" }} />
                    Retrieving codebase chunks and analyzing...
                  </div>
                )}
              </div>

              {/* Cited Sources Strip */}
              {msg.sources && msg.sources.length > 0 && (
                <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid var(--border-subtle)" }}>
                  <div
                    style={{
                      fontSize: "0.6875rem",
                      fontFamily: "var(--font-mono)",
                      color: "var(--text-muted)",
                      marginBottom: "0.45rem",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.3rem",
                    }}
                  >
                    <Layers size={11} /> RETRIEVED SOURCES ({msg.sources.length})
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                    {msg.sources.map((src, i) => (
                      <button
                        key={i}
                        onClick={() => handleCitationClick(src)}
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.3rem",
                          backgroundColor: "var(--code-bg)",
                          border: "1px solid var(--code-border)",
                          padding: "0.2rem 0.5rem",
                          borderRadius: "4px",
                          color: "var(--text-secondary)",
                          fontFamily: "var(--font-mono)",
                          fontSize: "0.6875rem",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.borderColor = "var(--border-hover)";
                          e.currentTarget.style.color = "var(--text-primary)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.borderColor = "var(--code-border)";
                          e.currentTarget.style.color = "var(--text-secondary)";
                        }}
                      >
                        <FileCode2 size={11} color="var(--accent-cyan)" />
                        {src.file}
                        {src.startLine && <span style={{ color: "var(--text-muted)" }}>:L{src.startLine}</span>}
                        <ExternalLink size={9} style={{ opacity: 0.6 }} />
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </main>

      {/* Suggestion Chips */}
      <div style={{ maxWidth: "880px", width: "100%", margin: "0 auto", padding: "0 1.5rem 0.5rem" }}>
        <div style={{ display: "flex", gap: "0.4rem", overflowX: "auto", paddingBottom: "0.25rem" }}>
          {SUGGESTIONS.map((s, idx) => (
            <button
              key={idx}
              disabled={isStreaming}
              onClick={() => handleSubmit(null, s)}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.3rem 0.65rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-surface)",
                color: "var(--text-secondary)",
                fontSize: "0.75rem",
                whiteSpace: "nowrap",
                cursor: "pointer",
                transition: "border-color 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
            >
              <Sparkles size={11} color="var(--text-muted)" />
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Input Form Bar */}
      <footer
        style={{
          borderTop: "1px solid var(--border-subtle)",
          backgroundColor: "var(--bg-surface)",
          padding: "0.875rem 1.5rem 1.25rem",
        }}
      >
        <form
          onSubmit={handleSubmit}
          style={{
            maxWidth: "880px",
            margin: "0 auto",
            display: "flex",
            gap: "0.5rem",
            position: "relative",
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about authentication flow, database models, route handlers..."
            disabled={isStreaming}
            style={{
              flex: 1,
              backgroundColor: "var(--bg-app)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "6px",
              padding: "0.75rem 1rem",
              color: "var(--text-primary)",
              fontSize: "0.875rem",
              fontFamily: "inherit",
              outline: "none",
              transition: "border-color 0.15s ease",
            }}
            onFocus={(e) => (e.target.style.borderColor = "var(--border-hover)")}
            onBlur={(e) => (e.target.style.borderColor = "var(--border-subtle)")}
          />
          <button
            type="submit"
            disabled={isStreaming || !input.trim()}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.35rem",
              padding: "0 1.25rem",
              borderRadius: "6px",
              border: "1px solid var(--border-subtle)",
              backgroundColor: isStreaming || !input.trim() ? "var(--bg-surface-hover)" : "var(--text-primary)",
              color: isStreaming || !input.trim() ? "var(--text-muted)" : "var(--bg-app)",
              fontWeight: 600,
              fontSize: "0.8125rem",
              cursor: isStreaming || !input.trim() ? "not-allowed" : "pointer",
              transition: "all 0.15s ease",
            }}
          >
            <span>Ask</span>
            <ArrowRight size={14} />
          </button>
        </form>
      </footer>

      {/* Code Snippet Modal */}
      {activeCitation && (
        <CodeModal
          citation={activeCitation}
          repoPath={repoPath}
          onClose={() => setActiveCitation(null)}
        />
      )}

      {/* Add Repository Modal */}
      {showAddModal && (
        <AddRepoModal
          onClose={() => setShowAddModal(false)}
          onRepoAdded={(newRepoData) => {
            fetchRepos();
            const newId = typeof newRepoData === "object" ? (newRepoData.id || newRepoData.path || newRepoData.name) : newRepoData;
            setRepoPath(newId);
          }}
        />
      )}
    </div>
  );
}
