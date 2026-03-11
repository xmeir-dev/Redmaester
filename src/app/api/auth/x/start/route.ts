import { NextResponse } from "next/server";

import { createPkcePair } from "@/lib/auth/pkce";
import { getXAuthorizeUrl } from "@/lib/auth/x-auth";

export async function GET(request: Request) {
  try {
    const { state, verifier, challenge } = createPkcePair();

    const redirect = NextResponse.redirect(getXAuthorizeUrl(state, challenge));
    redirect.cookies.set("x_oauth_state", state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60
    });
    redirect.cookies.set("x_pkce_verifier", verifier, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60
    });

    return redirect;
  } catch (error) {
    const origin = new URL(request.url).origin;
    const message = error instanceof Error ? error.message : "oauth_setup_error";
    return NextResponse.redirect(
      new URL(`/?connect_error=${encodeURIComponent(message)}`, origin)
    );
  }
}
