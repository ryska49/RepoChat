import React, { useState } from "react";
import { X, GitBranch, Folder, Loader2, Plus, CheckCircle2, AlertCircle } from "lucide-react";

export default function AddRepoModal({ onClose, onRepoAdded }) {
  const [activeTab, setActiveTab] = useState("github"); // "github" | "local"
  const [repoInput, setRepoInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!repoInput.trim() || loading) return;

    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const res = await fetch("/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: repoInput.trim() }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add repository");

      setSuccess(`Repository ready: ${data.name || data.repoPath} (${data.chunkCount || 0} chunks indexed)`);
      setTimeout(() => {
        onRepoAdded(data);
        onClose();
      }, 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
          maxWidth: "520px",
          borderRadius: "8px",
          backgroundColor: "#121215",
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
            padding: "1rem 1.25rem",
            borderBottom: "1px solid var(--border-subtle)",
            backgroundColor: "var(--bg-surface)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <Plus size={16} color="var(--accent-cyan)" />
            <span style={{ fontSize: "0.875rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Add Repository
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab switch */}
        <div style={{ display: "flex", borderBottom: "1px solid var(--border-subtle)", background: "var(--bg-app)" }}>
          <button
            type="button"
            onClick={() => { setActiveTab("github"); setRepoInput(""); setError(null); }}
            style={{
              flex: 1,
              padding: "0.65rem",
              background: activeTab === "github" ? "var(--bg-card)" : "transparent",
              border: "none",
              borderBottom: activeTab === "github" ? "2px solid var(--accent-primary)" : "2px solid transparent",
              color: activeTab === "github" ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
            }}
          >
            <GitBranch size={14} /> GitHub Repository
          </button>
          <button
            type="button"
            onClick={() => { setActiveTab("local"); setRepoInput(""); setError(null); }}
            style={{
              flex: 1,
              padding: "0.65rem",
              background: activeTab === "local" ? "var(--bg-card)" : "transparent",
              border: "none",
              borderBottom: activeTab === "local" ? "2px solid var(--accent-primary)" : "2px solid transparent",
              color: activeTab === "local" ? "var(--text-primary)" : "var(--text-muted)",
              fontSize: "0.8125rem",
              fontWeight: 500,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.4rem",
            }}
          >
            <Folder size={14} /> Local Folder Path
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} style={{ padding: "1.25rem" }}>
          <label style={{ display: "block", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: "0.5rem" }}>
            {activeTab === "github" ? "GitHub Repository URL" : "Path on Local Machine"}
          </label>
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder={
              activeTab === "github"
                ? "https://github.com/expressjs/express"
                : "repos/demo or C:/Users/.../my-repo"
            }
            disabled={loading}
            style={{
              width: "100%",
              backgroundColor: "var(--bg-app)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "6px",
              padding: "0.65rem 0.85rem",
              color: "var(--text-primary)",
              fontFamily: "var(--font-mono)",
              fontSize: "0.8125rem",
              outline: "none",
              marginBottom: "0.5rem",
            }}
          />

          <div style={{ fontSize: "0.7rem", color: "var(--text-muted)", marginBottom: "1rem", lineHeight: 1.4 }}>
            💡 All source files are indexed with 100% full context. Standard repos index in 10–30s.
          </div>

          {error && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "#f87171", fontSize: "0.75rem", marginBottom: "1rem" }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          {success && (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--accent-emerald)", fontSize: "0.75rem", marginBottom: "1rem" }}>
              <CheckCircle2 size={14} /> {success}
            </div>
          )}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              style={{
                padding: "0.5rem 1rem",
                borderRadius: "6px",
                border: "1px solid var(--border-subtle)",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: "0.8125rem",
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !repoInput.trim()}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "0.4rem",
                padding: "0.5rem 1.25rem",
                borderRadius: "6px",
                border: "none",
                background: "var(--accent-primary)",
                color: "#fff",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: loading || !repoInput.trim() ? "not-allowed" : "pointer",
                opacity: loading || !repoInput.trim() ? 0.6 : 1,
              }}
            >
              {loading && <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />}
              {loading ? (activeTab === "github" ? "Cloning & Indexing..." : "Indexing...") : "Ingest Repository"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
