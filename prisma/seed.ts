import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const existing = await prisma.bookmark.count();
  const seedDemo = (process.env.SEED_DEMO_DATA ?? "false").toLowerCase() === "true";

  if (existing > 0 || !seedDemo) {
    return;
  }

  await prisma.bookmark.create({
    data: {
      id: "1890000000000000001",
      text: "Teams that pair quick user interviews with weekly product demos ship features users actually keep.",
      authorHandle: "buildwithsam",
      authorName: "Sam R.",
      url: "https://x.com/buildwithsam/status/1890000000000000001",
      rawJson: JSON.stringify({ seeded: true }),
      bookmarkedAt: new Date()
    }
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
