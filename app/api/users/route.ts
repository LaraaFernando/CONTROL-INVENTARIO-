import { env } from "cloudflare:workers";
import {
  AuthError,
  PERMISSION_KEYS,
  PERMISSION_LABELS,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  hashPassword,
  isRole,
  normalizeUsername,
  permissionsFor,
  requireUser,
  sanitizePermissionOverrides,
  validateCredentials,
} from "../../auth";

async function requireAccessManager(request: Request) {
  const actor = await requireUser(request);
  if (actor.role !== "superadmin") throw new AuthError("Solo los administradores principales pueden gestionar usuarios y permisos.", 403);
  return actor;
}

async function activeSuperadminCount() {
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users WHERE role='superadmin' AND active=1").first<{total:number}>();
  return Number(row?.total ?? 0);
}

export async function GET(request: Request) {
  try {
    const actor = await requireAccessManager(request);
    const rows = await env.DB.prepare(`
      SELECT id, username, display_name, role, permissions, active, created_at
      FROM users ORDER BY active DESC, display_name COLLATE NOCASE
    `).all<{id:number;username:string;display_name:string;role:string;permissions:string;active:number;created_at:string}>();
    return Response.json({
      users: rows.results.map((row) => {
        const role = isRole(row.role) ? row.role : "consulta";
        let overrides = {};
        try { overrides = sanitizePermissionOverrides(JSON.parse(row.permissions || "{}")); } catch {}
        return { id: row.id, username: row.username, displayName: row.display_name, role, active: Boolean(row.active), permissions: permissionsFor(role, overrides), overrides, createdAt: row.created_at };
      }),
      roles: ROLE_LABELS,
      roleDefaults: ROLE_DEFAULTS,
      permissionLabels: PERMISSION_LABELS,
      permissionKeys: PERMISSION_KEYS,
      currentUserId: actor.id,
      superadminLimit: 2,
      activeSuperadmins: await activeSuperadminCount(),
    });
  } catch (error) { return response(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await requireAccessManager(request);
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");

    if (action === "add_user") {
      const username = String(body.username ?? "");
      const password = String(body.password ?? "");
      const displayName = String(body.displayName ?? "").trim();
      const roleRaw = String(body.role ?? "consulta");
      if (!isRole(roleRaw)) throw new AuthError("Rol inválido.", 400);
      if (roleRaw === "superadmin" && await activeSuperadminCount() >= 2) throw new AuthError("Solo puede haber 2 administradores principales activos.", 409);
      validateCredentials(username, password);
      const { hash, salt } = await hashPassword(password);
      const overrides = roleRaw === "superadmin" ? {} : sanitizePermissionOverrides(body.permissions);
      await env.DB.prepare(`
        INSERT INTO users (username, display_name, password_hash, password_salt, role, permissions)
        VALUES (?, ?, ?, ?, ?, ?)
      `).bind(normalizeUsername(username), displayName || normalizeUsername(username), hash, salt, roleRaw, JSON.stringify(overrides)).run();
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "update_user") {
      const id = Number(body.id);
      const roleRaw = String(body.role ?? "consulta");
      if (!id || !isRole(roleRaw)) throw new AuthError("Datos de usuario inválidos.", 400);
      const current = await env.DB.prepare("SELECT role, active FROM users WHERE id=? LIMIT 1").bind(id).first<{role:string;active:number}>();
      if (!current) throw new AuthError("Usuario no encontrado.", 404);
      if (id === actor.id && roleRaw !== "superadmin") throw new AuthError("No puedes quitarte tu propio perfil de administrador principal.", 400);
      if (roleRaw === "superadmin" && current.role !== "superadmin" && current.active && await activeSuperadminCount() >= 2) throw new AuthError("Solo puede haber 2 administradores principales activos.", 409);
      if (current.role === "superadmin" && roleRaw !== "superadmin" && current.active && await activeSuperadminCount() <= 1) throw new AuthError("Debe existir al menos un administrador principal activo.", 409);
      const displayName = String(body.displayName ?? "").trim();
      const overrides = roleRaw === "superadmin" ? {} : sanitizePermissionOverrides(body.permissions);
      await env.DB.prepare("UPDATE users SET display_name=?, role=?, permissions=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(displayName || "Usuario", roleRaw, JSON.stringify(overrides), id).run();
      return Response.json({ ok: true });
    }

    if (action === "toggle_user") {
      const id = Number(body.id); const active = Boolean(body.active);
      if (!id) throw new AuthError("Usuario inválido.", 400);
      const current = await env.DB.prepare("SELECT role, active FROM users WHERE id=? LIMIT 1").bind(id).first<{role:string;active:number}>();
      if (!current) throw new AuthError("Usuario no encontrado.", 404);
      if (id === actor.id && !active) throw new AuthError("No puedes desactivar tu propia cuenta.", 400);
      if (current.role === "superadmin" && !active && current.active && await activeSuperadminCount() <= 1) throw new AuthError("Debe existir al menos un administrador principal activo.", 409);
      if (current.role === "superadmin" && active && !current.active && await activeSuperadminCount() >= 2) throw new AuthError("Solo puede haber 2 administradores principales activos.", 409);
      await env.DB.prepare("UPDATE users SET active=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(active ? 1 : 0, id).run();
      if (!active) await env.DB.prepare("DELETE FROM sessions WHERE user_id=?").bind(id).run();
      return Response.json({ ok: true });
    }

    if (action === "reset_password") {
      const id = Number(body.id); const password = String(body.password ?? "");
      if (!id) throw new AuthError("Usuario inválido.", 400);
      const { hash, salt } = await hashPassword(password);
      await env.DB.prepare("UPDATE users SET password_hash=?, password_salt=?, updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(hash, salt, id).run();
      await env.DB.prepare("DELETE FROM sessions WHERE user_id=? AND user_id<>?").bind(id, actor.id).run();
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) { return response(error); }
}

function response(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const text = error instanceof Error ? error.message : "Error inesperado";
  if (text.includes("UNIQUE constraint failed")) return Response.json({ error: "Ese nombre de usuario ya existe." }, { status: 409 });
  return Response.json({ error: text }, { status: 500 });
}
