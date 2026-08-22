import { and, desc, eq, lte } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { clients, creditNotes, movements, products } from "../../../db/schema";
import { AuthError, PermissionKey, requirePermission, requireUser } from "../../auth";

const positiveTypes = new Set(["inventario_inicial", "entrada_compra", "devolucion_cliente", "ajuste_positivo"]);
const negativeTypes = new Set(["venta", "defectuoso", "devolucion_proveedor", "ajuste_negativo"]);
const movementPermission: Record<string, PermissionKey> = {
  entrada_compra: "movements.purchase",
  venta: "movements.sale",
  defectuoso: "movements.defective",
  devolucion_cliente: "movements.returns",
  devolucion_proveedor: "movements.returns",
  ajuste_positivo: "movements.adjust",
  ajuste_negativo: "movements.adjust",
};

function message(error: unknown) {
  if (error instanceof AuthError) return error.message;
  const text = error instanceof Error ? error.message : "Error inesperado";
  if (text.includes("no such table")) return "La base de datos aún no está inicializada.";
  if (text.includes("UNIQUE constraint failed")) return "El SKU o folio ya está registrado.";
  return text;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: message(error) }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const db = getDb();
    const [productRows, clientRows, movementRows, creditRows, lowStockRows] = await Promise.all([
      db.select().from(products).where(eq(products.active, 1)).orderBy(products.name),
      db.select().from(clients).where(eq(clients.active, 1)).orderBy(clients.name),
      db.select({
        id: movements.id, type: movements.type, quantity: movements.quantity, delta: movements.delta,
        reference: movements.reference, notes: movements.notes, performedBy: movements.performedBy,
        voided: movements.voided, voidedBy: movements.voidedBy, voidedAt: movements.voidedAt,
        createdAt: movements.createdAt, productId: products.id, productName: products.name, sku: products.sku,
        clientName: clients.name,
      }).from(movements).innerJoin(products, eq(movements.productId, products.id)).leftJoin(clients, eq(movements.clientId, clients.id)).orderBy(desc(movements.id)).limit(200),
      db.select({
        id: creditNotes.id, folio: creditNotes.folio, saleReference: creditNotes.saleReference,
        amount: creditNotes.amount, reason: creditNotes.reason, status: creditNotes.status, notes: creditNotes.notes,
        createdAt: creditNotes.createdAt, clientId: clients.id, clientName: clients.name,
      }).from(creditNotes).innerJoin(clients, eq(creditNotes.clientId, clients.id)).where(eq(creditNotes.active, 1)).orderBy(desc(creditNotes.id)).limit(200),
      db.select().from(products).where(and(eq(products.active, 1), lte(products.currentStock, products.minimumStock))).orderBy(products.currentStock),
    ]);

    const canSeeCost = user.permissions["products.view_cost"];
    const safeProducts = productRows.map((p) => canSeeCost ? p : { ...p, cost: 0 });
    const safeLowStock = lowStockRows.map((p) => canSeeCost ? p : { ...p, cost: 0 });
    const inventoryValue = canSeeCost ? productRows.reduce((sum, p) => sum + p.cost * p.currentStock, 0) : null;
    const today = new Date().toISOString().slice(0, 10);
    const activeMovements = movementRows.filter((m) => !m.voided);
    const todayMovements = activeMovements.filter((m) => m.createdAt.slice(0, 10) === today);

    return Response.json({
      products: safeProducts,
      clients: clientRows,
      movements: movementRows,
      creditNotes: creditRows,
      lowStock: safeLowStock,
      summary: {
        productCount: productRows.length,
        units: productRows.reduce((s, p) => s + p.currentStock, 0),
        inventoryValue,
        todayMovements: todayMovements.length,
      },
      auth: user,
    });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    const db = getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const performedBy = user.displayName;

    if (action === "add_product") {
      requirePermission(user, "products.create");
      const sku = String(body.sku ?? "").trim().toUpperCase();
      const name = String(body.name ?? "").trim();
      const initialStock = Math.max(0, Number(body.initialStock ?? 0));
      if (!sku || !name) return Response.json({ error: "SKU y producto son obligatorios." }, { status: 400 });
      const [product] = await db.insert(products).values({
        sku, name, category: String(body.category ?? "General"), unit: String(body.unit ?? "pieza"),
        cost: Math.max(0, Number(body.cost ?? 0)), salePrice: Math.max(0, Number(body.salePrice ?? 0)),
        currentStock: initialStock, minimumStock: Math.max(0, Number(body.minimumStock ?? 0)),
        location: String(body.location ?? ""), active: 1,
      }).returning();
      if (initialStock > 0) await db.insert(movements).values({
        productId: product.id, type: "inventario_inicial", quantity: initialStock, delta: initialStock,
        reference: "ALTA", notes: "Inventario al registrar el producto", performedBy,
      });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "edit_product") {
      requirePermission(user, "products.edit");
      const id = Number(body.id); const sku = String(body.sku ?? "").trim().toUpperCase(); const name = String(body.name ?? "").trim();
      if (!id || !sku || !name) return Response.json({ error: "Producto, SKU y nombre son obligatorios." }, { status: 400 });
      const [existing] = await db.select().from(products).where(and(eq(products.id, id), eq(products.active, 1))).limit(1);
      if (!existing) return Response.json({ error: "Producto no encontrado." }, { status: 404 });
      await db.update(products).set({
        sku, name, category: String(body.category ?? "General"), unit: String(body.unit ?? "pieza"),
        cost: user.permissions["products.view_cost"] ? Math.max(0, Number(body.cost ?? existing.cost)) : existing.cost,
        salePrice: Math.max(0, Number(body.salePrice ?? existing.salePrice)),
        minimumStock: Math.max(0, Number(body.minimumStock ?? existing.minimumStock)), location: String(body.location ?? ""),
      }).where(and(eq(products.id, id), eq(products.active, 1)));
      return Response.json({ ok: true });
    }

    if (action === "delete_product") {
      requirePermission(user, "products.delete");
      const id = Number(body.id);
      if (!id) return Response.json({ error: "Producto inválido." }, { status: 400 });
      await db.update(products).set({ active: 0 }).where(eq(products.id, id));
      return Response.json({ ok: true });
    }

    if (action === "add_client") {
      requirePermission(user, "clients.create");
      const name = String(body.name ?? "").trim();
      if (!name) return Response.json({ error: "El nombre del cliente es obligatorio." }, { status: 400 });
      await db.insert(clients).values({
        name, businessName: String(body.businessName ?? ""), taxId: String(body.taxId ?? ""),
        phone: String(body.phone ?? ""), email: String(body.email ?? ""), address: String(body.address ?? ""), active: 1,
      });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "edit_client") {
      requirePermission(user, "clients.edit");
      const id = Number(body.id); const name = String(body.name ?? "").trim();
      if (!id || !name) return Response.json({ error: "Cliente y nombre son obligatorios." }, { status: 400 });
      await db.update(clients).set({
        name, businessName: String(body.businessName ?? ""), taxId: String(body.taxId ?? ""),
        phone: String(body.phone ?? ""), email: String(body.email ?? ""), address: String(body.address ?? ""),
      }).where(and(eq(clients.id, id), eq(clients.active, 1)));
      return Response.json({ ok: true });
    }

    if (action === "delete_client") {
      requirePermission(user, "clients.delete");
      const id = Number(body.id);
      if (!id) return Response.json({ error: "Cliente inválido." }, { status: 400 });
      await db.update(clients).set({ active: 0 }).where(eq(clients.id, id));
      return Response.json({ ok: true });
    }

    if (action === "add_movement") {
      const productId = Number(body.productId);
      const clientId = body.clientId ? Number(body.clientId) : null;
      const type = String(body.type ?? "");
      const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 0)));
      if (!productId || (!positiveTypes.has(type) && !negativeTypes.has(type)) || type === "inventario_inicial") return Response.json({ error: "Selecciona producto y tipo de movimiento." }, { status: 400 });
      const permission = movementPermission[type];
      if (!permission) return Response.json({ error: "Tipo de movimiento no permitido." }, { status: 400 });
      requirePermission(user, permission);
      const [product] = await db.select().from(products).where(and(eq(products.id, productId), eq(products.active, 1))).limit(1);
      if (!product) return Response.json({ error: "Producto no encontrado." }, { status: 404 });
      const delta = positiveTypes.has(type) ? quantity : -quantity;
      const newStock = product.currentStock + delta;
      if (newStock < 0) return Response.json({ error: `No hay suficiente existencia. Disponible: ${product.currentStock}.` }, { status: 400 });
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO movements (product_id, client_id, type, quantity, delta, reference, notes, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
          .bind(productId, clientId, type, quantity, delta, String(body.reference ?? ""), String(body.notes ?? ""), performedBy),
        env.DB.prepare("UPDATE products SET current_stock=? WHERE id=?").bind(newStock, productId),
      ]);
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "void_movement") {
      requirePermission(user, "movements.delete");
      const id = Number(body.id);
      if (!id) return Response.json({ error: "Movimiento inválido." }, { status: 400 });
      const movement = await env.DB.prepare(`SELECT id, product_id, delta, voided FROM movements WHERE id=? LIMIT 1`).bind(id).first<{id:number;product_id:number;delta:number;voided:number}>();
      if (!movement) return Response.json({ error: "Movimiento no encontrado." }, { status: 404 });
      if (movement.voided) return Response.json({ error: "Ese movimiento ya fue anulado." }, { status: 409 });
      const product = await env.DB.prepare("SELECT current_stock FROM products WHERE id=? LIMIT 1").bind(movement.product_id).first<{current_stock:number}>();
      if (!product) return Response.json({ error: "Producto relacionado no encontrado." }, { status: 404 });
      const correctedStock = Number(product.current_stock) - Number(movement.delta);
      if (correctedStock < 0) return Response.json({ error: "No se puede anular porque dejaría el inventario en negativo. Corrige primero movimientos posteriores." }, { status: 409 });
      await env.DB.batch([
        env.DB.prepare("UPDATE products SET current_stock=? WHERE id=?").bind(correctedStock, movement.product_id),
        env.DB.prepare("UPDATE movements SET voided=1, voided_by=?, voided_at=CURRENT_TIMESTAMP WHERE id=?").bind(performedBy, id),
      ]);
      return Response.json({ ok: true });
    }

    if (action === "add_credit_note") {
      requirePermission(user, "credit_notes.create");
      const folio = String(body.folio ?? "").trim().toUpperCase();
      const clientId = Number(body.clientId); const amount = Number(body.amount ?? 0); const reason = String(body.reason ?? "").trim();
      if (!folio || !clientId || amount <= 0 || !reason) return Response.json({ error: "Folio, cliente, importe y motivo son obligatorios." }, { status: 400 });
      await db.insert(creditNotes).values({
        folio, clientId, amount, reason, saleReference: String(body.saleReference ?? ""),
        status: "Pendiente", notes: String(body.notes ?? ""), active: 1,
      });
      return Response.json({ ok: true }, { status: 201 });
    }

    if (action === "update_credit_status") {
      requirePermission(user, "credit_notes.status");
      const id = Number(body.id); const status = String(body.status ?? "");
      if (!id || !["Pendiente", "Aplicada", "Cancelada"].includes(status)) return Response.json({ error: "Datos inválidos." }, { status: 400 });
      await db.update(creditNotes).set({ status }).where(and(eq(creditNotes.id, id), eq(creditNotes.active, 1)));
      return Response.json({ ok: true });
    }

    if (action === "delete_credit_note") {
      requirePermission(user, "credit_notes.delete");
      const id = Number(body.id);
      if (!id) return Response.json({ error: "Nota de crédito inválida." }, { status: 400 });
      await env.DB.prepare("UPDATE credit_notes SET active=0, status='Cancelada', voided_by=?, voided_at=CURRENT_TIMESTAMP WHERE id=?")
        .bind(performedBy, id).run();
      return Response.json({ ok: true });
    }

    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) { return errorResponse(error); }
}
