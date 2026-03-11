"use client";

import { FormEvent, useState } from "react";

type ChatAnswer = {
  answer: string;
  usedModel: string;
  sources: Array<{ tweetId: string; url: string; authorHandle: string }>;
};

const starterPrompts = [
  "What marketing lessons keep repeating in my bookmarks?",
  "What should a product strategist learn from the last 30 bookmarks?",
  "Give me 5 practical growth insights from my saved tweets."
];

export function AskChat() {
  const [question, setQuestion] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ChatAnswer | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed) {
      setError("Enter a question first.");
      return;
    }

    setError("");
    setIsLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed })
      });

      const payload = (await response.json().catch(() => ({}))) as ChatAnswer & { error?: string };
      if (!response.ok) {
        setError(payload.error ?? "Could not generate an answer.");
        setResult(null);
        return;
      }

      setResult(payload);
    } catch {
      setError("Request failed. Please try again.");
      setResult(null);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="panel" style={{ display: "grid", gap: 14 }}>
      <h2>Ask Redmaester</h2>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 10 }}>
        <textarea
          className="ask-input"
          rows={4}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about what matters in your bookmarks..."
        />
        <div className="actions">
          <button className="button" type="submit" disabled={isLoading}>
            {isLoading ? "Thinking..." : "Ask"}
          </button>
        </div>
      </form>

      <div className="ask-quick-prompts">
        {starterPrompts.map((prompt) => (
          <button key={prompt} className="button secondary" onClick={() => setQuestion(prompt)} type="button">
            {prompt}
          </button>
        ))}
      </div>

      {error ? <p className="list-meta" style={{ color: "var(--danger)" }}>{error}</p> : null}

      {result ? (
        <article className="ask-answer-card">
          <p className="list-meta">Model: {result.usedModel}</p>
          <p className="ask-answer">{result.answer}</p>
          <div style={{ display: "grid", gap: 6 }}>
            <p className="list-meta">Sources</p>
            {result.sources.length === 0 ? (
              <p className="list-meta">No matching source bookmarks found.</p>
            ) : (
              result.sources.map((source) => (
                <a key={`${source.tweetId}-${source.url}`} className="list-meta" href={source.url} target="_blank" rel="noreferrer">
                  @{source.authorHandle} · {source.tweetId}
                </a>
              ))
            )}
          </div>
        </article>
      ) : null}
    </section>
  );
}
