import { NextResponse, type NextRequest } from "next/server";
import { LANG_HEADER } from "./locales";

/** Forwards `?lang=de` to the root layout, which cannot read search params itself. */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(LANG_HEADER);
  const lang = request.nextUrl.searchParams.get("lang");
  if (lang) headers.set(LANG_HEADER, lang);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.svg$).*)"],
};
