"use client";

import { useState } from "react";

type ClassificationResult = {
  type: "skill" | "reference" | "unrelated";
  confidence: number;
  rationale: string;
  skillName?: string;
  suggestedSkillName?: string;
  matchedSkillName?: string;
  matchedSkillId?: string;
  extractedSkillContent?: string;
  fallback: boolean;
  usage?: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  };
};

type ApiResponse = {
  classification: ClassificationResult;
  extractedContent?: string;
  error?: string;
};

const PRESETS: { label: string; tweetText: string; content: string }[] = [
  {
    label: "System prompt",
    tweetText: "This Claude Code skill is incredible for code review",
    content: `# Code Review Agent

## Identity
You are a senior software engineer specializing in code review. Your role is to provide thorough, constructive feedback on pull requests.

## Instructions
- Review code for correctness, performance, and maintainability
- Flag potential security vulnerabilities
- Suggest improvements with concrete code examples
- Be constructive and educational in your feedback

## Constraints
- Never approve code with known security issues
- Always explain the reasoning behind your suggestions
- Focus on the most impactful issues first

## Output Format
Provide your review as a structured markdown document with sections for:
1. Summary
2. Critical Issues
3. Suggestions
4. Positive Highlights`,
  },
  {
    label: "Skill article",
    tweetText:
      "Great guide on building Claude Code skills and custom slash commands",
    content: `# How to Build Custom Claude Code Skills

This guide covers everything you need to know about building effective skills for Claude Code.

## What is a SKILL.md?

A SKILL.md file is a markdown document that defines a reusable agent configuration. It tells Claude Code how to behave for a specific task — code review, documentation, testing, etc.

## Best Practices for Prompt Engineering

1. **Be specific about the role**: Start with a clear identity statement
2. **Define constraints**: What should the agent never do?
3. **Provide examples**: Show the expected input/output format
4. **Use structured output**: Define clear output schemas

## Agent Design Patterns

- Chain-of-thought prompting for complex reasoning tasks
- Few-shot examples for consistent formatting
- System prompt layering for multi-step workflows

These patterns help create more reliable and consistent agent behaviors.`,
  },
  {
    label: "Unrelated",
    tweetText: "Just finished making the best pasta carbonara recipe",
    content: `# Classic Pasta Carbonara

## Ingredients
- 400g spaghetti
- 200g guanciale or pancetta
- 4 large egg yolks
- 100g Pecorino Romano, finely grated
- Freshly ground black pepper

## Instructions
1. Cook pasta in salted boiling water until al dente
2. Cut guanciale into small strips and cook until crispy
3. Mix egg yolks with grated cheese and pepper
4. Toss hot pasta with guanciale, then add egg mixture off heat
5. Stir vigorously to create a creamy sauce

The key is to never add the eggs over direct heat — the residual warmth from the pasta is enough to create the silky sauce without scrambling the eggs.`,
  },
];

const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  skill: { bg: "rgba(34,197,94,0.15)", text: "#22c55e" },
  reference: { bg: "rgba(59,130,246,0.15)", text: "#3b82f6" },
  unrelated: { bg: "rgba(156,163,175,0.15)", text: "#9ca3af" },
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  fontSize: 14,
  borderRadius: 8,
  border: "1px solid hsl(0 0% 20%)",
  background: "hsl(220 13% 10%)",
  color: "hsl(0 0% 90%)",
  outline: "none",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 500,
  color: "hsl(0 0% 60%)",
  marginBottom: 6,
};

const smallBtnStyle: React.CSSProperties = {
  padding: "8px 16px",
  fontSize: 13,
  fontWeight: 500,
  borderRadius: 6,
  border: "1px solid hsl(0 0% 22%)",
  background: "hsl(220 13% 14%)",
  color: "hsl(0 0% 75%)",
  cursor: "pointer",
};

export default function ClassifyDemoPage() {
  const [tweetText, setTweetText] = useState("");
  const [url, setUrl] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  async function handleFetchUrl() {
    if (!url.trim()) return;
    setFetching(true);
    setFetchInfo(null);

    try {
      const res = await fetch(
        `/api/demo/classify?url=${encodeURIComponent(url.trim())}`
      );
      const data = await res.json();

      if (data.error && !data.content) {
        setFetchInfo(`Fetch failed: ${data.error}`);
        return;
      }

      if (data.content) {
        setContent(data.content);
        const method = data.fetchMethod ?? "unknown";
        const chars = data.content.length;
        setFetchInfo(
          `Fetched via ${method} — ${chars.toLocaleString()} chars${data.title ? ` — "${data.title}"` : ""}`
        );
      } else {
        setFetchInfo("No content returned");
      }
    } catch (err) {
      setFetchInfo(
        `Fetch error: ${err instanceof Error ? err.message : "unknown"}`
      );
    } finally {
      setFetching(false);
    }
  }

  async function handleClassify() {
    if (!tweetText && !content && !url) return;
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/demo/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tweetText,
          content: content || undefined,
          url: url.trim() && !content ? url.trim() : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      const data: ApiResponse = await res.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function applyPreset(preset: (typeof PRESETS)[number]) {
    setTweetText(preset.tweetText);
    setContent(preset.content);
    setUrl("");
    setResult(null);
    setError(null);
    setFetchInfo(null);
  }

  const c = result?.classification;
  const colors = c ? TYPE_COLORS[c.type] : null;
  const canClassify = !!(tweetText || content || url.trim());

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "hsl(220 13% 8%)",
        color: "hsl(0 0% 90%)",
        fontFamily: "'IBM Plex Sans', 'Helvetica Neue', sans-serif",
      }}
    >
      <div style={{ maxWidth: 720, margin: "0 auto", padding: "48px 24px" }}>
        <h1
          style={{
            fontSize: 24,
            fontWeight: 600,
            marginBottom: 4,
            color: "hsl(0 0% 95%)",
          }}
        >
          Classify Demo
        </h1>
        <p
          style={{
            fontSize: 14,
            color: "hsl(0 0% 50%)",
            marginBottom: 32,
          }}
        >
          Paste a URL or content to see how the classification pipeline
          responds. Stateless — no DB, no side effects.
        </p>

        {/* Presets */}
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 24,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <span style={{ fontSize: 12, color: "hsl(0 0% 40%)", marginRight: 4 }}>
            Presets:
          </span>
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid hsl(0 0% 20%)",
                background: "hsl(220 13% 12%)",
                color: "hsl(0 0% 65%)",
                cursor: "pointer",
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Tweet text */}
          <div>
            <label style={labelStyle}>Tweet text</label>
            <input
              type="text"
              value={tweetText}
              onChange={(e) => setTweetText(e.target.value)}
              placeholder="The bookmark tweet text..."
              style={inputStyle}
            />
          </div>

          {/* URL */}
          <div>
            <label style={labelStyle}>URL (fetched like enrichment)</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  setFetchInfo(null);
                }}
                placeholder="https://example.com/article..."
                style={{ ...inputStyle, flex: 1 }}
              />
              <button
                onClick={handleFetchUrl}
                disabled={fetching || !url.trim()}
                style={{
                  ...smallBtnStyle,
                  opacity: !url.trim() ? 0.4 : 1,
                  cursor: fetching || !url.trim() ? "not-allowed" : "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                {fetching ? "Fetching..." : "Fetch"}
              </button>
            </div>
            {fetchInfo && (
              <p
                style={{
                  marginTop: 6,
                  fontSize: 12,
                  color: fetchInfo.startsWith("Fetch failed")
                    ? "hsl(0 72% 60%)"
                    : "hsl(0 0% 45%)",
                }}
              >
                {fetchInfo}
              </p>
            )}
          </div>

          {/* Content */}
          <div>
            <label style={labelStyle}>
              Content{" "}
              <span style={{ fontWeight: 400, color: "hsl(0 0% 40%)" }}>
                — paste directly, or fetch from URL above
              </span>
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Paste the article, system prompt, or skill content..."
              rows={12}
              style={{
                ...inputStyle,
                lineHeight: 1.5,
                resize: "vertical",
                fontFamily: "'IBM Plex Mono', monospace",
              }}
            />
          </div>

          {/* Classify button */}
          <button
            onClick={handleClassify}
            disabled={loading || !canClassify}
            style={{
              padding: "10px 20px",
              fontSize: 14,
              fontWeight: 600,
              borderRadius: 8,
              border: "none",
              background: loading ? "hsl(0 0% 25%)" : "hsl(0 72% 42%)",
              color: "white",
              cursor: loading || !canClassify ? "not-allowed" : "pointer",
              opacity: !canClassify ? 0.4 : 1,
              alignSelf: "flex-start",
            }}
          >
            {loading ? "Classifying..." : "Classify"}
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              marginTop: 24,
              padding: "12px 16px",
              borderRadius: 8,
              border: "1px solid hsl(0 72% 42%)",
              background: "hsla(0, 72%, 42%, 0.1)",
              color: "hsl(0 72% 60%)",
              fontSize: 14,
            }}
          >
            {error}
          </div>
        )}

        {/* Results */}
        {c && (
          <div
            style={{
              marginTop: 32,
              border: "1px solid hsl(0 0% 18%)",
              borderRadius: 10,
              background: "hsl(220 13% 10%)",
              overflow: "hidden",
            }}
          >
            {/* Header row */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "16px 20px",
                borderBottom: "1px solid hsl(0 0% 18%)",
              }}
            >
              <span
                style={{
                  padding: "4px 12px",
                  borderRadius: 999,
                  fontSize: 13,
                  fontWeight: 600,
                  background: colors?.bg,
                  color: colors?.text,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                {c.type}
              </span>

              <span
                style={{
                  fontSize: 14,
                  fontWeight: 600,
                  color: "hsl(0 0% 80%)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {Math.round(c.confidence * 100)}%
              </span>

              {c.fallback && (
                <span
                  style={{
                    padding: "3px 8px",
                    borderRadius: 4,
                    fontSize: 11,
                    fontWeight: 500,
                    background: "hsla(45, 100%, 50%, 0.12)",
                    color: "hsl(45, 100%, 60%)",
                  }}
                >
                  FALLBACK
                </span>
              )}

              {(c.skillName || c.suggestedSkillName || c.matchedSkillName) && (
                <span
                  style={{
                    marginLeft: "auto",
                    fontSize: 13,
                    color: "hsl(0 0% 55%)",
                  }}
                >
                  {c.matchedSkillName
                    ? `matched: ${c.matchedSkillName}`
                    : c.skillName
                      ? `skill: ${c.skillName}`
                      : `suggested: ${c.suggestedSkillName}`}
                </span>
              )}
            </div>

            {/* Rationale */}
            <div style={{ padding: "16px 20px" }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  color: "hsl(0 0% 50%)",
                  marginBottom: 6,
                }}
              >
                Rationale
              </div>
              <p
                style={{
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: "hsl(0 0% 80%)",
                  margin: 0,
                }}
              >
                {c.rationale}
              </p>
            </div>

            {/* Usage */}
            {c.usage && (
              <div
                style={{
                  padding: "12px 20px",
                  borderTop: "1px solid hsl(0 0% 15%)",
                  fontSize: 12,
                  color: "hsl(0 0% 45%)",
                  display: "flex",
                  gap: 16,
                }}
              >
                <span>{c.usage.model}</span>
                <span>
                  {c.usage.inputTokens + c.usage.outputTokens} tokens
                </span>
                <span>${c.usage.costUsd.toFixed(4)}</span>
              </div>
            )}

            {/* Extracted content */}
            {result?.extractedContent && (
              <div
                style={{
                  borderTop: "1px solid hsl(0 0% 18%)",
                  padding: "16px 20px",
                }}
              >
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "hsl(0 0% 50%)",
                    marginBottom: 8,
                  }}
                >
                  Extracted SKILL.md
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: 16,
                    borderRadius: 8,
                    background: "hsl(220 13% 7%)",
                    border: "1px solid hsl(0 0% 15%)",
                    fontSize: 13,
                    lineHeight: 1.5,
                    color: "hsl(0 0% 75%)",
                    overflow: "auto",
                    maxHeight: 400,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {result.extractedContent}
                </pre>
              </div>
            )}

            {/* Raw JSON toggle */}
            <div
              style={{
                borderTop: "1px solid hsl(0 0% 18%)",
                padding: "12px 20px",
              }}
            >
              <button
                onClick={() => setShowRaw(!showRaw)}
                style={{
                  fontSize: 12,
                  color: "hsl(0 0% 45%)",
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                  textDecoration: "underline",
                  textUnderlineOffset: 2,
                }}
              >
                {showRaw ? "Hide" : "Show"} raw JSON
              </button>
              {showRaw && (
                <pre
                  style={{
                    marginTop: 12,
                    padding: 16,
                    borderRadius: 8,
                    background: "hsl(220 13% 7%)",
                    border: "1px solid hsl(0 0% 15%)",
                    fontSize: 12,
                    lineHeight: 1.5,
                    color: "hsl(0 0% 60%)",
                    overflow: "auto",
                    maxHeight: 300,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                    fontFamily: "'IBM Plex Mono', monospace",
                  }}
                >
                  {JSON.stringify(result, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
