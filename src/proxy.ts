import { createServerClient } from "@supabase/ssr";
import { NextRequest, NextResponse } from "next/server";
import { authCookieOptions } from "@/lib/server/config";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY)
    return response;
  const client = createServerClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    {
      cookieOptions: authCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  const { data } = await client.auth.getClaims();
  if (request.nextUrl.pathname === "/" && data?.claims.sub) {
    const destination = NextResponse.redirect(
      new URL("/dashboard", request.url),
    );
    response.cookies
      .getAll()
      .forEach((cookie) => destination.cookies.set(cookie));
    response = destination;
  }
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/", "/dashboard/:path*", "/api/host/:path*", "/auth/:path*"],
};
