import { prisma } from "@/lib/db/prisma";
import { appConfig } from "@/lib/domain/config";
import { refreshAccessToken, type XMe, type XTokenResponse } from "@/lib/auth/x-auth";

type StoredToken = {
  userId: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
};

const REFRESH_BUFFER_MS = 90_000;

export async function saveXToken(user: XMe, token: XTokenResponse): Promise<void> {
  await prisma.authToken.upsert({
    where: {
      provider_userId: {
        provider: "x",
        userId: user.id
      }
    },
    create: {
      provider: "x",
      userId: user.id,
      username: user.username,
      displayName: user.name,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
      tokenType: token.tokenType
    },
    update: {
      username: user.username,
      displayName: user.name,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
      tokenType: token.tokenType
    }
  });
}

function isExpiringSoon(expiresAt?: Date): boolean {
  if (!expiresAt) {
    return false;
  }

  return expiresAt.getTime() - Date.now() < REFRESH_BUFFER_MS;
}

async function getPreferredTokenRecord() {
  if (appConfig.xDefaultUserId) {
    return prisma.authToken.findUnique({
      where: {
        provider_userId: {
          provider: "x",
          userId: appConfig.xDefaultUserId
        }
      }
    });
  }

  return prisma.authToken.findFirst({
    where: { provider: "x" },
    orderBy: { updatedAt: "desc" }
  });
}

export async function getActiveXToken(): Promise<StoredToken | null> {
  const record = await getPreferredTokenRecord();
  if (!record) {
    return null;
  }

  if (!isExpiringSoon(record.expiresAt ?? undefined)) {
    return {
      userId: record.userId,
      accessToken: record.accessToken,
      refreshToken: record.refreshToken ?? undefined,
      expiresAt: record.expiresAt ?? undefined
    };
  }

  if (!record.refreshToken) {
    return {
      userId: record.userId,
      accessToken: record.accessToken,
      refreshToken: undefined,
      expiresAt: record.expiresAt ?? undefined
    };
  }

  const refreshed = await refreshAccessToken(record.refreshToken);

  await prisma.authToken.update({
    where: { id: record.id },
    data: {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? record.refreshToken,
      expiresAt: refreshed.expiresAt,
      scope: refreshed.scope,
      tokenType: refreshed.tokenType
    }
  });

  return {
    userId: record.userId,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? record.refreshToken,
    expiresAt: refreshed.expiresAt
  };
}

export async function getXConnectionStatus(): Promise<{
  connected: boolean;
  username?: string;
  displayName?: string;
}> {
  const record = await getPreferredTokenRecord();

  if (!record) {
    return { connected: false };
  }

  return {
    connected: true,
    username: record.username ?? undefined,
    displayName: record.displayName ?? undefined
  };
}
