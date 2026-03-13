import { BookmarkRoleType, SkillKind, TriageStatus } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db/prisma";
import { getOpenclawWorkspace } from "@/lib/settings/service";
import { writeSkillMd } from "@/lib/openclaw/filesystem";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as {
      triageId: string;
      approved: boolean;
      editedSkillName?: string;
      editedSkillContent?: string;
    };

    const { triageId, approved, editedSkillName, editedSkillContent } = body;

    if (!triageId) {
      return NextResponse.json({ error: "triageId is required" }, { status: 400 });
    }

    const triageItem = await prisma.triageQueue.findUnique({
      where: { id: triageId }
    });

    if (!triageItem) {
      return NextResponse.json({ error: "Triage item not found" }, { status: 404 });
    }

    if (!approved) {
      // Reject
      await prisma.triageQueue.update({
        where: { id: triageId },
        data: {
          status: TriageStatus.RESOLVED,
          assignedSkillName: "rejected",
          resolvedAt: new Date()
        }
      });

      // Update classification action if exists
      await prisma.bookmarkClassification.updateMany({
        where: { bookmarkId: triageItem.tweetId },
        data: { action: "no_action" }
      });

      return NextResponse.json({ ok: true, action: "rejected" });
    }

    // Approve — find classification for this bookmark
    const classification = await prisma.bookmarkClassification.findUnique({
      where: { bookmarkId: triageItem.tweetId }
    });

    const skillName = editedSkillName ?? classification?.extractedSkillName ?? "unnamed-skill";
    const skillContent = editedSkillContent ?? classification?.extractedSkillContent;

    if (!skillContent) {
      return NextResponse.json(
        { error: "No skill content available. Provide editedSkillContent." },
        { status: 400 }
      );
    }

    // Sanitize name
    const kebabName = skillName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    // Check for name collision
    let finalName = kebabName;
    const existing = await prisma.skill.findUnique({ where: { name: kebabName } });
    if (existing) {
      finalName = `${kebabName}-${Date.now()}`;
    }

    // Create skill
    const lines = skillContent
      .split("\n")
      .map((l: string) => l.trim())
      .filter(Boolean)
      .filter((l: string) => !l.startsWith("#"));
    const description = lines[0]?.slice(0, 200) ?? `Skill: ${finalName}`;

    const masterSkill = classification?.bucketId
      ? await prisma.skill.findFirst({
          where: {
            bucketId: classification.bucketId,
            kind: SkillKind.MASTER
          },
          select: { id: true }
        })
      : null;

    const skill = await prisma.skill.create({
      data: {
        name: finalName,
        content: skillContent,
        description,
        source: "bookmark",
        kind: SkillKind.MICRO,
        bucketId: classification?.bucketId ?? null,
        parentSkillId: masterSkill?.id,
        sourceBookmarkId: triageItem.tweetId
      }
    });

    // Sync to OpenClaw if configured
    const workspace = await getOpenclawWorkspace();
    if (workspace) {
      try {
        await writeSkillMd(workspace, finalName, skillContent);
      } catch {
        // Best effort — don't fail the approval
      }
    }

    // Update classification
    if (classification) {
      await prisma.bookmarkClassification.update({
        where: { id: classification.id },
        data: {
          action: "user_approved",
          classificationType: "micro_skill",
          roleType: BookmarkRoleType.MICRO_SKILL,
          targetSkillId: skill.id,
          extractedSkillName: finalName,
          extractedSkillContent: skillContent
        }
      });
    }

    // Resolve triage
    await prisma.triageQueue.update({
      where: { id: triageId },
      data: {
        status: TriageStatus.RESOLVED,
        assignedSkillName: finalName,
        resolvedAt: new Date()
      }
    });

    return NextResponse.json({
      ok: true,
      action: "approved",
      skillId: skill.id,
      skillName: finalName
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Resolve failed" },
      { status: 500 }
    );
  }
}
