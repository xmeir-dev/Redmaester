import { z } from "zod";

import { appConfig } from "@/lib/domain/config";

const tokenSchema = z.object({
  token_type: z.string(),
  expires_in: z.number().optional(),
  access_token: z.string(),
  scope: z.string().optional(),
  refresh_token: z.string().optional()
});

const meSchema = z.object({
  data: z.object({
    id: z.string(),
    username: z.string(),
    name: z.string().optional()
  })
});

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function xApiUrl(path: string): string {
  const base = trimTrailingSlash(appConfig.xApiBaseUrl);
  if (path.startsWith("/")) {
    return `${base}${path}`;
  }
  return `${base}/${path}`;
}

function tokenAuthHeaders(): HeadersInit {
  const headers: HeadersInit = {
    "Content-Type": "application/x-www-form-urlencoded"
  };

  if (appConfig.xClientSecret) {
    const basic = Buffer.from(`${appConfig.xClientId}:${appConfig.xClientSecret}`).toString("base64");
    headers.Authorization = `Basic ${basic}`;
  }

  return headers;
}

export function getXAuthorizeUrl(state: string, codeChallenge: string): string {
  if (!appConfig.xClientId) {
    throw new Error("X_CLIENT_ID is required before starting OAuth flow.");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: appConfig.xClientId,
    redirect_uri: appConfig.xRedirectUri,
    scope: appConfig.xOauthScopes.join(" "),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });

  return `https://x.com/i/oauth2/authorize?${params.toString()}`;
}

export type XTokenResponse = {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  scope?: string;
  tokenType?: string;
};

function toTokenResponse(parsed: z.infer<typeof tokenSchema>): XTokenResponse {
  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token,
    expiresAt: parsed.expires_in ? new Date(Date.now() + parsed.expires_in * 1000) : undefined,
    scope: parsed.scope,
    tokenType: parsed.token_type
  };
}

export async function exchangeCodeForToken(code: string, verifier: string): Promise<XTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: appConfig.xRedirectUri,
    code_verifier: verifier,
    client_id: appConfig.xClientId
  });

  const response = await fetch(xApiUrl("/2/oauth2/token"), {
    method: "POST",
    headers: tokenAuthHeaders(),
    body
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`X token exchange failed (${response.status}): ${message}`);
  }

  const parsed = tokenSchema.parse(await response.json());
  return toTokenResponse(parsed);
}

export async function refreshAccessToken(refreshToken: string): Promise<XTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: appConfig.xClientId
  });

  const response = await fetch(xApiUrl("/2/oauth2/token"), {
    method: "POST",
    headers: tokenAuthHeaders(),
    body
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`X refresh token failed (${response.status}): ${message}`);
  }

  const parsed = tokenSchema.parse(await response.json());
  return toTokenResponse(parsed);
}

export type XMe = {
  id: string;
  username: string;
  name?: string;
};

export async function fetchXMe(accessToken: string): Promise<XMe> {
  const response = await fetch(xApiUrl("/2/users/me?user.fields=name,username"), {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`X /users/me failed (${response.status}): ${message}`);
  }

  const parsed = meSchema.parse(await response.json());
  return {
    id: parsed.data.id,
    username: parsed.data.username,
    name: parsed.data.name
  };
}
