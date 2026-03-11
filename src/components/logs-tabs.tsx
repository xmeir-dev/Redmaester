"use client";

import { useState } from "react";

type SyncRunItem = {
  id: string;
  mode: string;
  status: string;
  newBookmarks: number;
  routedCount: number;
  triagedCount: number;
  classifiedCount: number;
  skillsCreated: number;
  notes: string | null;
};

type ClassificationItem = {
  id: string;
  classificationType: string;
  action: string;
  confidence: number;
  matchedSkill: { name: string } | null;
  bookmark: {
    text: string;
    authorHandle: string;
  };
};

type TabKey = "sync" | "classifications";

export function LogsTabs({
  recentRuns,
  recentClassifications
}: {
  recentRuns: SyncRunItem[];
  recentClassifications: ClassificationItem[];
}) {
  const [activeTab, setActiveTab] = useState<TabKey>("sync");

  return (
    <section className="panel">
      <h2>Logs</h2>
      <div className="tab-row" role="tablist" aria-label="Logs tabs">
        <button
          className={`tab-button${activeTab === "sync" ? " active" : ""}`}
          role="tab"
          aria-selected={activeTab === "sync"}
          onClick={() => setActiveTab("sync")}
        >
          Sync Runs
        </button>
        <button
          className={`tab-button${activeTab === "classifications" ? " active" : ""}`}
          role="tab"
          aria-selected={activeTab === "classifications"}
          onClick={() => setActiveTab("classifications")}
        >
          Classifications
        </button>
      </div>

      {activeTab === "sync" ? (
        <div className="logs-table">
          {recentRuns.length === 0 ? (
            <p className="list-meta">No syncs yet.</p>
          ) : (
            recentRuns.map((run) => (
              <article key={run.id} className="log-row">
                <p className="log-main">
                  <strong>{run.mode}</strong> · {run.status}
                </p>
                <p className="list-meta">{run.newBookmarks} new</p>
                <p className="list-meta">{run.classifiedCount} classified</p>
                <p className="list-meta">{run.skillsCreated} skills created</p>
                <p className="list-meta">{run.triagedCount} triaged</p>
                <p className="list-meta">{run.notes ?? "-"}</p>
              </article>
            ))
          )}
        </div>
      ) : (
        <div className="logs-table">
          {recentClassifications.length === 0 ? (
            <p className="list-meta">No classifications yet.</p>
          ) : (
            recentClassifications.map((item) => (
              <article key={item.id} className="log-row">
                <p className="log-main">
                  <span className="badge">{item.classificationType}</span>
                  {item.bookmark.text}
                </p>
                <p className="list-meta">Conf {item.confidence.toFixed(2)}</p>
                <p className="list-meta">{item.action}</p>
                <p className="list-meta">{item.matchedSkill?.name ?? "-"}</p>
                <p className="list-meta">@{item.bookmark.authorHandle}</p>
              </article>
            ))
          )}
        </div>
      )}
    </section>
  );
}
