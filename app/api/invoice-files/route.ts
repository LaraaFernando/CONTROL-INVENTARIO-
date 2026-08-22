import { env } from "cloudflare:workers";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { ensureOperationalSchema, recordAudit } from "../../../db/operations";

type FileBucket = {
  put(key: string, value: ArrayBuffer, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream; httpMetadata?: { contentType?: string } } | null>;
};

function bucket() {
  const storage = (env as unknown as { FILES?: FileBucket }).FILES;
  if (!storage) throw new AuthError("El almacenamiento privado de facturas todavía no está disponible.", 503);
  return storage;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "Error inesperado" }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "invoices.files");
    await ensureOperationalSchema();
    const id = Number(new URL(request.url).searchParams.get("id") || 0);
    const metadata = await env.DB.prepare(`SELECT id, file_name, content_type, storage_key
      FROM invoice_files WHERE id=? LIMIT 1`).bind(id).first<{
        id: number; file_name: string; content_type: string; storage_key: string;
      }>();
    if (!metadata) throw new AuthError("Archivo no encontrado.", 404);
    const object = await bucket().get(metadata.storage_key);
    if (!object) throw new AuthError("El archivo ya no existe en el almacenamiento privado.", 404);
    return new Response(object.body, {
      headers: {
        "content-type": object.httpMetadata?.contentType || metadata.content_type,
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(metadata.file_name)}`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "invoices.files");
    await ensureOperationalSchema();
    const form = await request.formData();
    const invoiceId = Number(form.get("invoiceId") || 0);
    const kind = String(form.get("kind") || "").toLowerCase();
    const file = form.get("file");
    if (!invoiceId || !(file instanceof File) || !["xml", "pdf"].includes(kind)) {
      throw new AuthError("Factura, tipo y archivo son obligatorios.", 400);
    }
    const invoice = await env.DB.prepare("SELECT id, folio, canceled FROM invoices WHERE id=? LIMIT 1")
      .bind(invoiceId).first<{ id: number; folio: string; canceled: number }>();
    if (!invoice || invoice.canceled) throw new AuthError("Factura no encontrada o cancelada.", 404);
    if (file.size <= 0 || file.size > 10 * 1024 * 1024) throw new AuthError("El archivo debe pesar entre 1 byte y 10 MB.", 400);
    const lowerName = file.name.toLowerCase();
    if (kind === "xml" && !lowerName.endsWith(".xml")) throw new AuthError("Selecciona un archivo XML.", 400);
    if (kind === "pdf" && !lowerName.endsWith(".pdf")) throw new AuthError("Selecciona un archivo PDF.", 400);
    const bytes = await file.arrayBuffer();
    if (kind === "xml") {
      const xml = new TextDecoder().decode(bytes);
      if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new AuthError("El XML contiene declaraciones no permitidas.", 400);
      if (!/<(?:cfdi:)?Comprobante\b/i.test(xml)) throw new AuthError("El XML no parece ser un CFDI válido.", 400);
    } else {
      const header = new TextDecoder().decode(bytes.slice(0, 5));
      if (header !== "%PDF-") throw new AuthError("El archivo no contiene una firma PDF válida.", 400);
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storageKey = `invoices/${invoiceId}/${crypto.randomUUID()}-${safeName}`;
    const contentType = kind === "xml" ? "application/xml" : "application/pdf";
    await bucket().put(storageKey, bytes, { httpMetadata: { contentType } });
    const result = await env.DB.prepare(`INSERT INTO invoice_files
      (invoice_id, kind, file_name, content_type, storage_key, size, uploaded_by_user_id, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(invoiceId, kind, file.name, contentType, storageKey, file.size, user.id, user.displayName).run();
    const fileId = Number(result.meta.last_row_id);
    await recordAudit({ entityType: "invoice", entityId: invoiceId, action: "adjuntar_archivo", user,
      after: { fileId, kind, fileName: file.name, size: file.size } });
    return Response.json({ ok: true, id: fileId }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
