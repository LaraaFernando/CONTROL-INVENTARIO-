import { and, desc, eq, lte } from "drizzle-orm";
import { getDb } from "../../../db";
import { clients, creditNotes, movements, products } from "../../../db/schema";

const positiveTypes = new Set(["inventario_inicial", "entrada_compra", "devolucion_cliente", "ajuste_positivo"]);
const negativeTypes = new Set(["venta", "defectuoso", "devolucion_proveedor", "ajuste_negativo"]);

function message(error: unknown) {
  const text = error instanceof Error ? error.message : "Error inesperado";
  if (text.includes("no such table")) return "La base de datos aún no está inicializada.";
  if (text.includes("UNIQUE constraint failed")) return "El SKU o folio ya está registrado.";
  return text;
}

export async function GET() {
  try {
    const db = getDb();
    const [productRows, clientRows, movementRows, creditRows, lowStockRows] = await Promise.all([
      db.select().from(products).orderBy(products.name),
      db.select().from(clients).orderBy(clients.name),
      db.select({ id: movements.id, type: movements.type, quantity: movements.quantity, delta: movements.delta, reference: movements.reference, notes: movements.notes, performedBy: movements.performedBy, createdAt: movements.createdAt, productId: products.id, productName: products.name, sku: products.sku, clientName: clients.name }).from(movements).innerJoin(products, eq(movements.productId, products.id)).leftJoin(clients, eq(movements.clientId, clients.id)).orderBy(desc(movements.id)).limit(100),
      db.select({ id: creditNotes.id, folio: creditNotes.folio, saleReference: creditNotes.saleReference, amount: creditNotes.amount, reason: creditNotes.reason, status: creditNotes.status, notes: creditNotes.notes, createdAt: creditNotes.createdAt, clientId: clients.id, clientName: clients.name }).from(creditNotes).innerJoin(clients, eq(creditNotes.clientId, clients.id)).orderBy(desc(creditNotes.id)).limit(100),
      db.select().from(products).where(lte(products.currentStock, products.minimumStock)).orderBy(products.currentStock),
    ]);
    const inventoryValue = productRows.reduce((sum, p) => sum + p.cost * p.currentStock, 0);
    const today = new Date().toISOString().slice(0, 10);
    const todayMovements = movementRows.filter((m) => m.createdAt.slice(0, 10) === today);
    return Response.json({ products: productRows, clients: clientRows, movements: movementRows, creditNotes: creditRows, lowStock: lowStockRows, summary: { productCount: productRows.length, units: productRows.reduce((s,p)=>s+p.currentStock,0), inventoryValue, todayMovements: todayMovements.length } });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const db = getDb();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const performedBy = request.headers.get("oai-authenticated-user-email") ?? "Usuario";
    if (action === "add_product") {
      const sku = String(body.sku ?? "").trim().toUpperCase(); const name = String(body.name ?? "").trim(); const initialStock = Math.max(0, Number(body.initialStock ?? 0));
      if (!sku || !name) return Response.json({ error: "SKU y producto son obligatorios." }, { status: 400 });
      const [product] = await db.insert(products).values({ sku, name, category: String(body.category ?? "General"), unit: String(body.unit ?? "pieza"), cost: Math.max(0, Number(body.cost ?? 0)), salePrice: Math.max(0, Number(body.salePrice ?? 0)), currentStock: initialStock, minimumStock: Math.max(0, Number(body.minimumStock ?? 0)), location: String(body.location ?? "") }).returning();
      if (initialStock > 0) await db.insert(movements).values({ productId: product.id, type: "inventario_inicial", quantity: initialStock, delta: initialStock, reference: "ALTA", notes: "Inventario al registrar el producto", performedBy });
      return Response.json({ ok: true }, { status: 201 });
    }
    if (action === "add_client") {
      const name = String(body.name ?? "").trim(); if (!name) return Response.json({ error: "El nombre del cliente es obligatorio." }, { status: 400 });
      await db.insert(clients).values({ name, businessName: String(body.businessName ?? ""), taxId: String(body.taxId ?? ""), phone: String(body.phone ?? ""), email: String(body.email ?? ""), address: String(body.address ?? "") });
      return Response.json({ ok: true }, { status: 201 });
    }
    if (action === "add_movement") {
      const productId = Number(body.productId); const clientId = body.clientId ? Number(body.clientId) : null; const type = String(body.type ?? ""); const quantity = Math.max(1, Math.floor(Number(body.quantity ?? 0)));
      if (!productId || (!positiveTypes.has(type) && !negativeTypes.has(type))) return Response.json({ error: "Selecciona producto y tipo de movimiento." }, { status: 400 });
      const [product] = await db.select().from(products).where(eq(products.id, productId)).limit(1); if (!product) return Response.json({ error: "Producto no encontrado." }, { status: 404 });
      const delta = positiveTypes.has(type) ? quantity : -quantity; const newStock = product.currentStock + delta;
      if (newStock < 0) return Response.json({ error: `No hay suficiente existencia. Disponible: ${product.currentStock}.` }, { status: 400 });
      await db.insert(movements).values({ productId, clientId, type, quantity, delta, reference: String(body.reference ?? ""), notes: String(body.notes ?? ""), performedBy });
      await db.update(products).set({ currentStock: newStock }).where(eq(products.id, productId)); return Response.json({ ok: true }, { status: 201 });
    }
    if (action === "add_credit_note") {
      const folio = String(body.folio ?? "").trim().toUpperCase(); const clientId = Number(body.clientId); const amount = Number(body.amount ?? 0); const reason = String(body.reason ?? "").trim();
      if (!folio || !clientId || amount <= 0 || !reason) return Response.json({ error: "Folio, cliente, importe y motivo son obligatorios." }, { status: 400 });
      await db.insert(creditNotes).values({ folio, clientId, amount, reason, saleReference: String(body.saleReference ?? ""), status: String(body.status ?? "Pendiente"), notes: String(body.notes ?? "") }); return Response.json({ ok: true }, { status: 201 });
    }
    if (action === "update_credit_status") {
      const id = Number(body.id); const status = String(body.status ?? ""); if (!id || !["Pendiente","Aplicada","Cancelada"].includes(status)) return Response.json({ error: "Datos inválidos." }, { status: 400 });
      await db.update(creditNotes).set({ status }).where(and(eq(creditNotes.id,id))); return Response.json({ ok: true });
    }
    return Response.json({ error: "Acción no reconocida." }, { status: 400 });
  } catch (error) { return Response.json({ error: message(error) }, { status: 500 }); }
}
