import React, { useEffect, useState, useRef } from "react";
import { X, FileCode, Copy, Check } from "lucide-react";

export default function CodeModal({ citation, repoPath, onClose }) {
  const [fileContent, setFileContent] = useState(null);
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
        setLoading(false);
      })
      .catch((err) => {
        console.error("Error fetching file:", err);
        setFileContent("// Unable to load file content from server.");
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
        zIndex: 50,
        background: "rgba(3, 7, 18, 0.8)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "1.5rem",
      }}
      onClick={onClose}
    >
      <div
        className="glass-panel"
        style={{
          width: "100%",
          maxWidth: "880px",
          height: "80vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0.875rem 1.25rem",
            borderBottom: "1px solid var(--border-subtle)",
            background: "rgba(10, 13, 20, 0.9)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <FileCode size={18} color="var(--accent-cyan)" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem", fontWeight: 600 }}>
              {citation.file}
            </span>
            {startLine && endLine && (
              <span
                style={{
                  background: "rgba(59, 130, 246, 0.15)",
                  color: "var(--accent-blue)",
                  padding: "0.15rem 0.5rem",
                  borderRadius: "9999px",
                  fontSize: "0.75rem",
                  fontFamily: "var(--font-mono)",
                }}
              >
                Lines {startLine}–{endLine}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <button
              onClick={handleCopy}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "0.35rem",
                padding: "0.35rem 0.65rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-tertiary)",
                color: "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "0.75rem",
              }}
            >
              {copied ? <Check size={14} color="var(--accent-emerald)" /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy Snippet"}
            </button>
            <button
              onClick={onClose}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                cursor: "pointer",
                padding: "0.25rem",
                borderRadius: "6px",
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Code Content */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "1rem 0",
            background: "var(--code-bg)",
            fontFamily: "var(--font-mono)",
            fontSize: "0.8125rem",
            lineHeight: 1.6,
          }}
        >
          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center", color: "var(--text-muted)" }}>
              Loading file snippet...
            </div>
          ) : (
            lines.map((lineText, idx) => {
              const lineNum = idx + 1;
              const isHighlighted = startLine && endLine && lineNum >= startLine && lineNum <= endLine;
              const isFirstHighlighted = lineNum === startLine;

              return (
                <div
                  key={lineNum}
                  ref={isFirstHighlighted ? highlightedRef : null}
                  style={{
                    display: "flex",
                    padding: "0 1.25rem",
                    background: isHighlighted ? "rgba(59, 130, 246, 0.12)" : "transparent",
                    borderLeft: isHighlighted ? "3px solid var(--accent-blue)" : "3px solid transparent",
                  }}
                >
                  <span
                    style={{
                      width: "3.5rem",
                      textAlign: "right",
                      paddingRight: "1.25rem",
                      color: isHighlighted ? "var(--accent-cyan)" : "var(--text-muted)",
                      userSelect: "none",
                      flexShrink: 0,
                    }}
                  >
                    {lineNum}
                  </span>
                  <span style={{ color: isHighlighted ? "#ffffff" : "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
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
