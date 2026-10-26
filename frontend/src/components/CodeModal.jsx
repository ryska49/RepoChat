import React, { useEffect, useState, useRef } from "react";
import { X, FileCode2, Copy, Check, Hash } from "lucide-react";

export default function CodeModal({ citation, repoPath, onClose }) {
  const [fileContent, setFileContent] = useState(null);
  const [fromIndex, setFromIndex] = useState(false);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const highlightedRef = useRef(null);

  useEffect(() => {
    if (!citation) return;
    setLoading(true);

    fetch(`/file?repoPath=${encodeURIComponent(repoPath)}&filePath=${encodeURIComponent(citation.file)}`)
      .then((res) => {
        if (!res.ok) throw new Error("File not found");
        return res.json();
      })
      .then((data) => {
        setFileContent(data.content);
        setFromIndex(!!data.fromIndex);
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching file:", err);
        setFileContent(`// Unable to load file "${citation.file}" from server for repository "${repoPath}".`);
        setFromIndex(false);
        setLoading(false);
      });
  }, [citation, repoPath]);

  useEffect(() => {
    if (!loading && highlightedRef.current) {
      highlightedRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading]);

  if (!citation) return null;

  const lines = (fileContent || "").split("\n");
  const startLine = citation.startLine;
  const endLine = citation.endLine;

  const handleCopy = () => {
    if (!fileContent) return;
    let snippet = fileContent;
    if (startLine && endLine) {
      snippet = lines.slice(startLine - 1, endLine).join("\n");
    }
    navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "880px",
          height: "80vh",
          display: "flex",
          flexDirection: "column",
          borderRadius: "8px",
          backgroundColor: "#0d0e12",
          border: "1px solid var(--border-subtle)",
          boxShadow: "0 20px 40px -15px rgba(0, 0, 0, 0.9)",
          overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.75rem 1.25rem",
            backgroundColor: "var(--bg-surface)",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <FileCode2 size={16} color="var(--accent-cyan)" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem", fontWeight: 500, color: "var(--text-primary)" }}>
              {citation.file}
            </span>
            {startLine && (
              <span
                style={{
                  backgroundColor: "rgba(56, 189, 248, 0.1)",
                  color: "var(--accent-cyan)",
                  border: "1px solid rgba(56, 189, 248, 0.2)",
                  padding: "0.1rem 0.45rem",
                  borderRadius: "4px",
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-mono)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.2rem",
                }}
              >
                <Hash size={10} />
                Lines {startLine}–{endLine || startLine}
              </span>
            )}
            {fromIndex && (
              <span
                style={{
                  backgroundColor: "rgba(16, 185, 129, 0.1)",
                  color: "var(--accent-emerald)",
                  border: "1px solid rgba(16, 185, 129, 0.2)",
                  padding: "0.1rem 0.45rem",
                  borderRadius: "4px",
                  fontSize: "0.6875rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                indexed snippet
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              onClick={handleCopy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.3rem",
                padding: "0.3rem 0.6rem",
                borderRadius: "4px",
                border: "1px solid var(--border-subtle)",
                backgroundColor: "var(--bg-card)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.75rem",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = "var(--border-hover)")}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = "var(--border-subtle)")}
            >
              {copied ? <Check size={12} color="var(--accent-emerald)" /> : <Copy size={12} />}
              <span>{copied ? "Copied" : "Copy Snippet"}</span>
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "0.3rem",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-primary)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "0.75rem 0",
            backgroundColor: "var(--code-bg)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
          }}
        >
          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)", fontSize: "0.8125rem" }}>
              Loading file snippet...
            </div>
          ) : (
            lines.map((lineText, idx) => {
              const lineNum = fromIndex ? ((startLine || 1) + idx) : (idx + 1);
              const isHighlighted = fromIndex || (startLine && endLine && lineNum >= startLine && lineNum <= endLine);
              const isFirstHighlighted = fromIndex ? idx === 0 : lineNum === startLine;

              return (
                <div
                  key={idx}
                  ref={isFirstHighlighted ? highlightedRef : null}
                  style={{
                    display: "flex",
                    padding: "0 1.25rem",
                    backgroundColor: isHighlighted ? "rgba(59, 130, 246, 0.08)" : "transparent",
                    borderLeft: isHighlighted ? "3px solid var(--accent-primary)" : "3px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: "3rem",
                      textAlign: "right",
                      paddingRight: "1.25rem",
                      color: isHighlighted ? "var(--accent-cyan)" : "var(--text-muted)",
                      userSelect: "none",
                      flexShrink: 0,
                      opacity: isHighlighted ? 1 : 0.6,
                    }}
                  >
                    {lineNum}
                  </span>
                  <span
                    style={{
                      color: isHighlighted ? "#f8fafc" : "#94a3b8",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-all",
                    }}
                  >
                    {lineText || " "}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
