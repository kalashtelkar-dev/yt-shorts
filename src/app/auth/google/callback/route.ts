// The redirect URI registered with Google. Better Auth handles the callback at /api/auth/callback/google;
// forward there with Google's code and state untouched.
export function GET(req: Request) {
  const url = new URL(req.url);
  return Response.redirect(new URL(`/api/auth/callback/google${url.search}`, url), 302);
}
