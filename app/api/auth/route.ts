import { AuthError, createInitialAdmin, createSession, destroySession, getUserFromRequest, hasUsers, verifyLogin } from "../../auth";

export async function GET(request: Request) {
  try {
    const setupRequired = !(await hasUsers());
    const user = setupRequired ? null : await getUserFromRequest(request);
    if (!user && !setupRequired) return Response.json({ setupRequired, authenticated: false }, { status: 401 });
    return Response.json({ setupRequired, authenticated: Boolean(user), user });
  } catch (error) {
    return authResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "bootstrap") {
      const id = await createInitialAdmin(String(body.username ?? ""), String(body.displayName ?? ""), String(body.password ?? ""));
      const session = await createSession(id);
      return Response.json({ ok: true }, { status: 201, headers: { "Set-Cookie": session.cookie } });
    }

    if (action === "login") {
      const user = await verifyLogin(String(body.username ?? ""), String(body.password ?? ""));
      const session = await createSession(user.id);
      return Response.json({ ok: true, user }, { headers: { "Set-Cookie": session.cookie } });
    }

    if (action === "logout") {
      const cookie = await destroySession(request);
      return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie } });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) {
    return authResponse(error);
  }
}

function authResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Error de autenticación." }, { status: 500 });
}
