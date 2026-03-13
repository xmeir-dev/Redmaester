"use client";

import { useState } from "react";

type SkillRow = {
  id: string;
  name: string;
  kind: string;
  description: string;
  source: string;
  bucketName: string | null;
  content: string;
  referenceCount: number;
  createdAt: string | Date;
};

export function SkillsList({ skills }: { skills: SkillRow[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (skills.length === 0) {
    return <p className="list-meta">No skills yet. Skills are created from bookmark classification or imported from OpenClaw.</p>;
  }

  return (
    <div className="list">
      {skills.map((skill) => (
        <article key={skill.id} className="list-item">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => setExpandedId(expandedId === skill.id ? null : skill.id)}
          >
            <div className="flex items-center gap-3">
              <span className="font-medium text-sm">{skill.name}</span>
              <span className="badge">{skill.kind.toLowerCase()}</span>
              <span className="badge">{skill.source}</span>
              {skill.bucketName ? <span className="list-meta">{skill.bucketName}</span> : null}
              <span className="list-meta">{skill.referenceCount} refs</span>
              <span className="list-meta ml-auto">
                {new Date(skill.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
              </span>
            </div>
            <p className="list-meta" style={{ marginTop: 4 }}>
              {skill.description.slice(0, 120)}
              {skill.description.length > 120 ? "..." : ""}
            </p>
          </button>

          {expandedId === skill.id ? (
            <div style={{ marginTop: 12 }}>
              <pre
                className="overflow-auto rounded bg-black/[0.03] p-3 text-xs"
                style={{ maxHeight: 400 }}
              >
                {skill.content.slice(0, 3000)}
                {skill.content.length > 3000 ? "\n\n[truncated]" : ""}
              </pre>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}
