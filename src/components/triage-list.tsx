"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type TriageItem = {
  id: string;
  tweetId: string;
  reason: string;
  details: string | null;
  bookmarkText: string;
  authorHandle: string;
  extractedSkillName: string | null;
  extractedSkillContent: string | null;
};

export function TriageList({ items }: { items: TriageItem[] }) {
  const router = useRouter();
  const [resolving, setResolving] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editContent, setEditContent] = useState("");

  async function handleResolve(item: TriageItem, approved: boolean) {
    setResolving(item.id);
    try {
      if (item.reason === "skill_review" || item.reason === "micro_skill_review") {
        const body: Record<string, unknown> = { triageId: item.id, approved };
        if (approved && editingId === item.id) {
          body.editedSkillName = editName;
          body.editedSkillContent = editContent;
        }
        await fetch("/api/triage/resolve-skill", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
      } else {
        await fetch("/api/triage/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ triageId: item.id, skillName: approved ? "approved" : "rejected" })
        });
      }
      router.refresh();
    } finally {
      setResolving(null);
      setEditingId(null);
    }
  }

  function startEditing(item: TriageItem) {
    setEditingId(item.id);
    setEditName(item.extractedSkillName ?? "");
    setEditContent(item.extractedSkillContent ?? "");
  }

  if (items.length === 0) {
    return <p className="list-meta">No triage items right now.</p>;
  }

  return (
    <div className="list">
      {items.map((item) => (
        <article key={item.id} className="list-item">
          <p>
            <span className={`badge ${item.reason === "skill_review" || item.reason === "micro_skill_review" ? "" : "danger"}`}>{item.reason}</span>
            <span className="list-meta">Tweet {item.tweetId}</span>
          </p>
          <p style={{ marginTop: 8 }}>{item.bookmarkText}</p>
          {item.details ? (
            <p className="list-meta" style={{ marginTop: 8 }}>
              {item.details}
            </p>
          ) : null}
          <p className="list-meta" style={{ marginTop: 8 }}>
            @{item.authorHandle}
          </p>

          {item.reason === "skill_review" || item.reason === "micro_skill_review" ? (
            <div style={{ marginTop: 12 }}>
              {editingId === item.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Skill name"
                    className="w-full rounded border border-black/10 px-3 py-1.5 text-sm"
                  />
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full rounded border border-black/10 px-3 py-2 text-sm font-mono"
                    rows={12}
                    style={{ maxHeight: 400 }}
                  />
                </div>
              ) : (
                <>
                  {item.extractedSkillName ? (
                    <p className="text-sm font-medium" style={{ marginBottom: 4 }}>
                      Skill: {item.extractedSkillName}
                    </p>
                  ) : null}
                  {item.extractedSkillContent ? (
                    <pre
                      className="overflow-auto rounded bg-black/[0.03] p-3 text-xs"
                      style={{ maxHeight: 400 }}
                    >
                      {item.extractedSkillContent.slice(0, 2000)}
                      {(item.extractedSkillContent.length ?? 0) > 2000 ? "\n..." : ""}
                    </pre>
                  ) : null}
                </>
              )}

              <div className="flex gap-2" style={{ marginTop: 8 }}>
                <button
                  type="button"
                  disabled={resolving === item.id}
                  onClick={() => handleResolve(item, true)}
                  className="rounded bg-black px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
                >
                  {resolving === item.id ? "Approving..." : "Approve"}
                </button>
                <button
                  type="button"
                  disabled={resolving === item.id}
                  onClick={() => handleResolve(item, false)}
                  className="rounded border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03] disabled:opacity-50"
                >
                  Reject
                </button>
                {editingId !== item.id ? (
                  <button
                    type="button"
                    onClick={() => startEditing(item)}
                    className="rounded border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]"
                  >
                    Edit Content
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded border border-black/10 px-3 py-1.5 text-sm hover:bg-black/[0.03]"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
