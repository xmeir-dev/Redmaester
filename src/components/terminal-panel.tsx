"use client";

import { useState } from "react";
import { ReaderCanvas } from "./reader-canvas";

const tabs = ["Chat", "Triage", "Sync"] as const;
type Tab = (typeof tabs)[number];

const examples: Record<Tab, string> = {
  Chat: `const res = await fetch("/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: "What bookmarks mention AI agents?",
    history: []
  })
});

const data = await res.json();
// => { answer: "...", sources: [...] }`,

  Triage: `const res = await fetch("/api/triage");

const { triage } = await res.json();
// => [{ id, bookmarkId, reason, ... }]`,

  Sync: `const res = await fetch("/api/sync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ mode: "AUTO" })
  // mode: "AUTO" | "FULL"
});

const data = await res.json();
// => { synced: 12, created: 3, ... }`,
};

function highlightLine(line: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let key = 0;

  // regex to match strings, comments, and keywords
  const tokenRe =
    /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\/\/.*$)|\b(const|let|var|await|async|function|return|new)\b|\b(true|false|null|undefined)\b/gm;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={key++}>{line.slice(lastIndex, match.index)}</span>);
    }

    if (match[1]) {
      // string literal
      parts.push(
        <span key={key++} className="text-green-400">
          {match[0]}
        </span>
      );
    } else if (match[2]) {
      // comment
      parts.push(
        <span key={key++} className="text-gray-500">
          {match[0]}
        </span>
      );
    } else if (match[3]) {
      // keyword
      parts.push(
        <span key={key++} className="text-purple-400">
          {match[0]}
        </span>
      );
    } else if (match[4]) {
      // boolean/null
      parts.push(
        <span key={key++} className="text-amber-400">
          {match[0]}
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    parts.push(<span key={key++}>{line.slice(lastIndex)}</span>);
  }

  return parts;
}

export function TerminalPanel() {
  const [activeTab, setActiveTab] = useState<Tab>("Chat");
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(examples[activeTab]).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  const lines = examples[activeTab].split("\n");

  return (
    <div className="w-[420px] shrink-0 hidden xl:block">
      <div className="sticky top-[calc(48px+40px+1px)] space-y-6">
      <div className="rounded-lg border border-gray-800 bg-[#0a0a0a] overflow-hidden shadow-2xl">
        {/* Title bar */}
        <div className="flex items-center gap-1.5 px-3 py-2 bg-gray-900/80 border-b border-gray-800">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
          <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
          <span className="ml-2 text-[11px] text-gray-500 font-mono">api-examples</span>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-gray-800">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setCopied(false); }}
              className={`flex-1 px-3 py-1.5 text-xs font-mono transition-colors ${
                activeTab === tab
                  ? "text-gray-100 bg-gray-800/60 border-b border-blue-500"
                  : "text-gray-500 hover:text-gray-300 hover:bg-gray-900/60"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Code block */}
        <div className="relative">
          <pre className="p-4 text-[12.5px] leading-5 font-mono text-gray-300 overflow-x-auto">
            <code>
              {lines.map((line, i) => (
                <div key={i}>{highlightLine(line) || "\u00A0"}</div>
              ))}
            </code>
          </pre>

          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="absolute top-2.5 right-2.5 px-2 py-1 rounded text-[11px] font-mono text-gray-400 hover:text-gray-200 bg-gray-800/70 hover:bg-gray-700/80 transition-colors"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* Footer hint */}
        <div className="px-4 pb-3 pt-0">
          <p className="text-[11px] text-gray-600 font-mono">
            {activeTab === "Chat" && "POST /api/chat — Ask questions about your bookmarks"}
            {activeTab === "Triage" && "GET /api/triage — Fetch items awaiting triage"}
            {activeTab === "Sync" && "POST /api/sync — Pull latest bookmarks from X"}
          </p>
        </div>
      </div>

      {/* Seated reader animation */}
      <div className="flex justify-center">
        <ReaderCanvas />
      </div>
      </div>
    </div>
  );
}
