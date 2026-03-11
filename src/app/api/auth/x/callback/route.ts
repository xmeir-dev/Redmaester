import { NextRequest, NextResponse } from "next/server";

import { fetchXMe, exchangeCodeForToken } from "@/lib/auth/x-auth";
import { saveXToken } from "@/lib/auth/token-store";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(new URL(`/?connect_error=${oauthError}`, url.origin));
  }

  if (!code || !state) {
    return NextResponse.redirect(new URL("/?connect_error=missing_code", url.origin));
  }

  const storedState = request.cookies.get("x_oauth_state")?.value;
  const verifier = request.cookies.get("x_pkce_verifier")?.value;

  if (!storedState || !verifier || storedState !== state) {
    return NextResponse.redirect(new URL("/?connect_error=invalid_state", url.origin));
  }

  try {
    const token = await exchangeCodeForToken(code, verifier);
    const me = await fetchXMe(token.accessToken);
    await saveXToken(me, token);

    const redirect = NextResponse.redirect(new URL("/?connected=1", url.origin));
    redirect.cookies.set("x_oauth_state", "", { path: "/", maxAge: 0 });
    redirect.cookies.set("x_pkce_verifier", "", { path: "/", maxAge: 0 });
    return redirect;
  } catch (error) {
    const message = error instanceof Error ? error.message : "oauth_failed";
    return NextResponse.redirect(
      new URL(`/?connect_error=${encodeURIComponent(message)}`, url.origin)
    );
  }
}
