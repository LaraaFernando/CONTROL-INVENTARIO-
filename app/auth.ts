import { env } from "cloudflare:workers";

export const SESSION_COOKIE = "herra_session";
const SESSION_DAYS = 7;
const PBKDF2_ITERATIONS = 100_000;

export const PERMISSION_KEYS = [
  "products.create",
  "products.edit",
  "products.delete",
  "products.view_cost",
  "clients.create",
  "clients.edit",
  "clients.delete",
  "movements.purchase",
  "movements.sale",
  "movements.defective",
  "movements.returns",
  "movements.adjust",
  "movements.delete",
  "credit_notes.create",
  "credit_notes.status",
  "credit_notes.delete",
  "suppliers.manage",
  "orders.manage",
  "invoices.manage",
  "invoices.files",
  "audit.view",
  "closures.manage",
  "users.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];
export type Role = "superadmin" | "admin" | "almacen" | "ventas" | "credito" | "consulta";
export type PermissionMap = Record<PermissionKey, boolean>;

export const ROLE_LABELS: Record<Role, string> = {
  superadmin: "Administrador principal",
  admin: "Administrador operativo",
  almacen: "Almacén",
  ventas: "Ventas",
  credito: "Crédito / Administración",
  consulta: "Solo consulta",
};

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  "products.create": "Crear productos",
  "products.edit": "Modificar datos maestros de productos",
  "products.delete": "Eliminar/desactivar productos",
  "products.view_cost": "Ver costos y valor del inventario",
  "clients.create": "Crear clientes",
  "clients.edit": "Modificar clientes",
  "clients.delete": "Eliminar/desactivar clientes",
  "movements.purchase": "Registrar entradas por compra",
  "movements.sale": "Registrar ventas",
  "movements.defective": "Registrar producto defectuoso",
  "movements.returns": "Registrar devoluciones",
  "movements.adjust": "Realizar ajustes de inventario",
  "movements.delete": "Anular movimientos y ventas conservando historial",
  "credit_notes.create": "Crear notas de crédito",
  "credit_notes.status": "Aplicar/cancelar notas de crédito",
  "credit_notes.delete": "Cancelar notas de crédito conservando historial",
  "suppliers.manage": "Administrar proveedores",
  "orders.manage": "Administrar pedidos y recepciones",
  "invoices.manage": "Administrar facturas y pagos",
  "invoices.files": "Cargar y descargar XML/PDF fiscales",
  "audit.view": "Consultar la bitácora de auditoría",
  "closures.manage": "Realizar y consultar cortes diarios",
  "users.manage": "Administrar usuarios y permisos",
};

const ALL = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, true])) as PermissionMap;
const NONE = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, false])) as PermissionMap;

export const ROLE_DEFAULTS: Record<Role, PermissionMap> = {
  superadmin: { ...ALL },
  admin: { ...ALL, "users.manage": false },
  almacen: {
    ...NONE,
    "products.create": true,
    "products.edit": true,
    "products.view_cost": true,
    "movements.purchase": true,
    "movements.defective": true,
    "movements.returns": true,
    "movements.adjust": true,
    "suppliers.manage": true,
    "orders.manage": true,
    "audit.view": true,
  },
  ventas: {
    ...NONE,
    "clients.create": true,
    "clients.edit": true,
    "movements.sale": true,
    "movements.returns": true,
    "invoices.manage": true,
    "invoices.files": true,
  },
  credito: {
    ...NONE,
    "clients.create": true,
    "clients.edit": true,
    "credit_notes.create": true,
    "credit_notes.status": true,
    "suppliers.manage": true,
    "orders.manage": true,
    "invoices.manage": true,
    "invoices.files": true,
    "audit.view": true,
    "closures.manage": true,
  },
  consulta: { ...NONE },
};

export type AuthUser = {
  id: number;
  username: string;
  displayName: string;
  role: Role;
  permissions: PermissionMap;
};

let schemaReady: Promise<void> | null = null;

export async function ensureSecuritySchema() {
  if (!schemaReady) {
    schemaReady = initializeSchema().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function initializeSchema() {
  const db = env.DB;
  if (!db) throw new Error("D1 binding DB no está disponible.");

  // Sites applies the packaged migrations before serving a version. Avoid
  // repeating schema writes on every fresh Worker isolate once the auth
  // tables exist: concurrent DDL during sign-in can hold D1 schema locks and
  // leave /api/auth waiting indefinitely.
  if (await securitySchemaExists(db)) return;

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'consulta',
      permissions TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY NOT NULL,
      user_id INTEGER NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at)`),
  ]);

  // Migración segura: conservar historial y permitir "eliminar" productos mediante desactivación.
  const info = await db.prepare("PRAGMA table_info(products)").all<{ name: string }>();
  if (!info.results.some((column) => column.name === "active")) {
    await db.prepare("ALTER TABLE products ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run();
  }

  const clientInfo = await db.prepare("PRAGMA table_info(clients)").all<{ name: string }>();
  if (!clientInfo.results.some((column) => column.name === "active")) {
    await db.prepare("ALTER TABLE clients ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run();
  }

  const movementInfo = await db.prepare("PRAGMA table_info(movements)").all<{ name: string }>();
  if (!movementInfo.results.some((column) => column.name === "voided")) await db.prepare("ALTER TABLE movements ADD COLUMN voided INTEGER NOT NULL DEFAULT 0").run();
  if (!movementInfo.results.some((column) => column.name === "voided_by")) await db.prepare("ALTER TABLE movements ADD COLUMN voided_by TEXT NOT NULL DEFAULT ''").run();
  if (!movementInfo.results.some((column) => column.name === "voided_at")) await db.prepare("ALTER TABLE movements ADD COLUMN voided_at TEXT").run();

  const creditInfo = await db.prepare("PRAGMA table_info(credit_notes)").all<{ name: string }>();
  if (!creditInfo.results.some((column) => column.name === "active")) await db.prepare("ALTER TABLE credit_notes ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run();
  if (!creditInfo.results.some((column) => column.name === "voided_by")) await db.prepare("ALTER TABLE credit_notes ADD COLUMN voided_by TEXT NOT NULL DEFAULT ''").run();
  if (!creditInfo.results.some((column) => column.name === "voided_at")) await db.prepare("ALTER TABLE credit_notes ADD COLUMN voided_at TEXT").run();

  // Si una instalación anterior ya tenía un administrador, conservarlo como uno de los dos administradores principales.
  const superCount = await db.prepare("SELECT COUNT(*) AS total FROM users WHERE role='superadmin' AND active=1").first<{ total: number }>();
  if (Number(superCount?.total ?? 0) === 0) {
    const firstAdmin = await db.prepare("SELECT id FROM users WHERE role='admin' AND active=1 ORDER BY id LIMIT 1").first<{ id: number }>();
    if (firstAdmin) await db.prepare("UPDATE users SET role='superadmin', permissions='{}', updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(firstAdmin.id).run();
  }

  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
}

async function securitySchemaExists(db: D1Database) {
  try {
    await db.batch([
      db.prepare("SELECT 1 FROM users LIMIT 1"),
      db.prepare("SELECT 1 FROM sessions LIMIT 1"),
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function hasUsers() {
  await ensureSecuritySchema();
  const row = await env.DB.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return Number(row?.total ?? 0) > 0;
}

export function permissionsFor(role: Role, overrides: Partial<PermissionMap> = {}): PermissionMap {
  if (role === "superadmin") return { ...ALL };
  return { ...ROLE_DEFAULTS[role], ...overrides };
}

export async function getUserFromRequest(request: Request): Promise<AuthUser | null> {
  await ensureSecuritySchema();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await env.DB.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.permissions
    FROM sessions s
    INNER JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.active = 1
    LIMIT 1
  `).bind(tokenHash).first<{id:number;username:string;display_name:string;role:string;permissions:string}>();
  if (!row) return null;
  const role = isRole(row.role) ? row.role : "consulta";
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    permissions: permissionsFor(role, parseOverrides(row.permissions)),
  };
}

export async function requireUser(request: Request): Promise<AuthUser> {
  const user = await getUserFromRequest(request);
  if (!user) throw new AuthError("Debes iniciar sesión.", 401);
  return user;
}

export function requirePermission(user: AuthUser, permission: PermissionKey) {
  if (!user.permissions[permission]) throw new AuthError("No tienes permiso para realizar esta acción.", 403);
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status = 401) {
    super(message);
    this.status = status;
  }
}

export async function createInitialAdmin(username: string, displayName: string, password: string) {
  await ensureSecuritySchema();
  if (await hasUsers()) throw new AuthError("El administrador inicial ya fue creado.", 409);
  validateCredentials(username, password);
  const { hash, salt } = await hashPassword(password);
  const result = await env.DB.prepare(`
    INSERT INTO users (username, display_name, password_hash, password_salt, role, permissions)
    VALUES (?, ?, ?, ?, 'superadmin', '{}')
  `).bind(normalizeUsername(username), displayName.trim() || "Administrador", hash, salt).run();
  return Number(result.meta.last_row_id);
}

export async function verifyLogin(username: string, password: string) {
  await ensureSecuritySchema();
  const row = await env.DB.prepare(`
    SELECT id, username, display_name, password_hash, password_salt, role, permissions
    FROM users WHERE username = ? AND active = 1 LIMIT 1
  `).bind(normalizeUsername(username)).first<{id:number;username:string;display_name:string;password_hash:string;password_salt:string;role:string;permissions:string}>();
  if (!row || !(await verifyPassword(password, row.password_salt, row.password_hash))) {
    throw new AuthError("Usuario o contraseña incorrectos.", 401);
  }
  const role = isRole(row.role) ? row.role : "consulta";
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role,
    permissions: permissionsFor(role, parseOverrides(row.permissions)),
  } satisfies AuthUser;
}

export async function createSession(userId: number) {
  await ensureSecuritySchema();
  const token = randomHex(32);
  const tokenHash = await sha256(token);
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  const sqliteExpires = expires.toISOString().slice(0, 19).replace("T", " ");
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(tokenHash, userId, sqliteExpires).run();
  return {
    token,
    cookie: `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`,
  };
}

export async function destroySession(request: Request) {
  await ensureSecuritySchema();
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256(token)).run();
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function hashPassword(password: string) {
  if (password.length < 8) throw new AuthError("La contraseña debe tener al menos 8 caracteres.", 400);
  const salt = randomHex(16);
  const hash = await derivePassword(password, salt);
  return { hash, salt };
}

export async function verifyPassword(password: string, salt: string, expected: string) {
  const actual = await derivePassword(password, salt);
  return timingSafeEqual(actual, expected);
}

export function validateCredentials(username: string, password: string) {
  const normalized = normalizeUsername(username);
  if (!/^[a-z0-9._-]{3,40}$/.test(normalized)) {
    throw new AuthError("El usuario debe tener 3–40 caracteres: letras, números, punto, guion o guion bajo.", 400);
  }
  if (password.length < 8) throw new AuthError("La contraseña debe tener al menos 8 caracteres.", 400);
}

export function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export function isRole(value: string): value is Role {
  return ["superadmin", "admin", "almacen", "ventas", "credito", "consulta"].includes(value);
}

export function sanitizePermissionOverrides(value: unknown): Partial<PermissionMap> {
  if (!value || typeof value !== "object") return {};
  const out: Partial<PermissionMap> = {};
  for (const key of PERMISSION_KEYS) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "boolean") out[key] = candidate;
  }
  return out;
}

function parseOverrides(value: string): Partial<PermissionMap> {
  try { return sanitizePermissionOverrides(JSON.parse(value || "{}")); } catch { return {}; }
}

function readCookie(header: string | null, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
}

async function derivePassword(password: string, saltHex: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({
    name: "PBKDF2",
    hash: "SHA-256",
    salt: hexToBytes(saltHex),
    iterations: PBKDF2_ITERATIONS,
  }, key, 256);
  return bytesToHex(new Uint8Array(bits));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToHex(new Uint8Array(digest));
}

function randomHex(length: number) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function hexToBytes(hex: string) {
  return Uint8Array.from(hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? []);
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

