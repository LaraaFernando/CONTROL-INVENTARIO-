import { env } from "cloudflare:workers";
import { assertBusinessDateOpen, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { normalizeCommercialUnit, presentationFactor, unitLabel } from "../../commercial-units";
import { ensureSaleTrackingSchema, nextSaleFolio } from "../../sale-tracking";

type SaleItemInput = { productId?: unknown; presentation?: unknown; quantity?: unknown };
type ProductRow = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  salePrice: number;
  currentStock: number;
  boxFactor: number;
};

type NormalizedLine = {
  productId: number;
  sku: string;
  productName: string;
  unit: string;
  presentation: string;
  presentationFactor: number;
  requestedQuantity: number;
  fulfilledQuantity: number;
  pendingQuantity: number;
  previousStock: number;
  newStock: number;
  unitAmount: number;
  totalAmount: number;
};

function text(value: unknown) { return String(value ?? "").trim(); }

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Error inesperado";
  if (message.toLowerCase().includes("negativo") || message.toLowerCase().includes("stock")) {
    return Response.json({ error: "La existencia cambió mientras se registraba la venta. Vuelve a intentarlo para usar el inventario actualizado." }, { status: 409 });
  }
  if (message.includes("UNIQUE constraint failed: sales.folio")) {
    return Response.json({ error: "No se pudo reservar un folio único. Vuelve a intentar la venta." }, { status: 409 });
  }
  return Response.json({ error: message }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "movements.sale");
    await ensureOperationalSchema();
    await ensureSaleTrackingSchema();
    const saleDate = businessDate();
    await assertBusinessDateOpen(saleDate);

    const body = await request.json() as Record<string, unknown>;
    const items = Array.isArray(body.items) ? body.items as SaleItemInput[] : [];
    if (!items.length) throw new AuthError("Agrega al menos un producto a la venta.", 400);

    const clientId = Number(body.clientId || 0);
    if (!clientId) throw new AuthError("Selecciona el cliente antes de confirmar la venta.", 400);
    const client = await env.DB.prepare("SELECT id, name FROM clients WHERE id=? AND active=1 LIMIT 1")
      .bind(clientId).first<{ id: number; name: string }>();
    if (!client) throw new AuthError("El cliente seleccionado no existe o está inactivo.", 404);

    const productResult = await env.DB.prepare(`
      SELECT id, sku, name, unit, sale_price AS salePrice, current_stock AS currentStock,
        box_factor AS boxFactor
      FROM products WHERE active = 1
    `).all<ProductRow>();
    const productMap = new Map((productResult.results ?? []).map(product => [Number(product.id), product]));
    const runningStock = new Map<number, number>();
    const lines: NormalizedLine[] = [];
    const shortages: string[] = [];

    for (const item of items) {
      const productId = Number(item.productId || 0);
      const quantity = Number(item.quantity || 0);
      if (!productId || !Number.isInteger(quantity) || quantity < 1) throw new AuthError("Cada partida debe tener un producto y una cantidad entera mayor a cero.", 400);
      const product = productMap.get(productId);
      if (!product) throw new AuthError("Uno de los productos ya no existe o está inactivo.", 404);

      const baseUnit = normalizeCommercialUnit(product.unit);
      const presentation = text(item.presentation).toLowerCase() || baseUnit;
      const factor = presentationFactor(product, presentation);
      if (!factor) throw new AuthError(`La presentación seleccionada no está configurada para ${product.name}.`, 400);
      const requestedQuantity = quantity * factor;
      const previousStock = runningStock.has(productId) ? Number(runningStock.get(productId)) : Number(product.currentStock);
      const fulfilledQuantity = Math.min(requestedQuantity, Math.max(0, previousStock));
      const pendingQuantity = Math.max(0, requestedQuantity - fulfilledQuantity);
      const newStock = previousStock - fulfilledQuantity;
      runningStock.set(productId, newStock);

      if (pendingQuantity > 0) shortages.push(`${product.sku} · ${product.name}: faltan ${pendingQuantity} ${unitLabel(baseUnit, pendingQuantity !== 1)}`);
      if (fulfilledQuantity === 0) continue;

      const unitAmount = Number(product.salePrice || 0);
      lines.push({ productId, sku: product.sku, productName: product.name, unit: baseUnit, presentation, presentationFactor: factor, requestedQuantity, fulfilledQuantity, pendingQuantity, previousStock, newStock, unitAmount, totalAmount: unitAmount * fulfilledQuantity });
    }

    if (!lines.length) throw new AuthError(shortages.length ? `No se pudo surtir ningún producto. ${shortages.join("; ")}.` : "No se pudo surtir ningún producto.", 409);

    const reference = await nextSaleFolio(saleDate);
    const externalReference = text(body.reference);
    const notes = text(body.notes);
    const totalAmount = lines.reduce((sum, line) => sum + line.totalAmount, 0);
    const statements: D1PreparedStatement[] = [
      env.DB.prepare(`
        INSERT INTO sales
          (folio, client_id, total_amount, external_reference, notes, created_by_user_id, created_by, business_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(reference, clientId, totalAmount, externalReference, notes, user.id, user.displayName, saleDate),
    ];

    for (const line of lines) {
      statements.push(env.DB.prepare(`
        INSERT INTO movements
        (product_id, client_id, type, quantity, delta, reference, notes, performed_by,
          unit_amount, total_amount, requested_quantity, pending_quantity, presentation,
          presentation_factor, performed_by_user_id, business_date, source_type)
        VALUES (?, ?, 'venta', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'sale')
      `).bind(line.productId, clientId, line.fulfilledQuantity, -line.fulfilledQuantity, reference, notes, user.displayName, line.unitAmount, line.totalAmount, line.requestedQuantity, line.pendingQuantity, line.presentation, line.presentationFactor, user.id, saleDate));
      statements.push(env.DB.prepare("UPDATE products SET current_stock = current_stock - ? WHERE id = ?").bind(line.fulfilledQuantity, line.productId));
    }

    const results = await env.DB.batch(statements);
    const saleId = Number(results[0]?.meta.last_row_id || 0);
    if (saleId) {
      await recordAudit({ entityType: "sale", entityId: saleId, action: "crear", user, after: { folio: reference, clientId, clientName: client.name, totalAmount, externalReference, lineCount: lines.length } });
    }

    const movementIds: number[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const movementId = Number(results[1 + index * 2]?.meta.last_row_id || 0);
      movementIds.push(movementId);
      const line = lines[index];
      if (movementId) await recordAudit({ entityType: "movement", entityId: movementId, action: "crear", user, after: { saleReference: reference, clientId, clientName: client.name, productId: line.productId, sku: line.sku, productName: line.productName, type: "venta", unit: line.unit, requestedQuantity: line.requestedQuantity, fulfilledQuantity: line.fulfilledQuantity, pendingQuantity: line.pendingQuantity, presentation: line.presentation, presentationFactor: line.presentationFactor, previousStock: line.previousStock, newStock: line.newStock, unitAmount: line.unitAmount, totalAmount: line.totalAmount } });
    }

    const warning = shortages.length ? `Venta ${reference} registrada por $${totalAmount.toFixed(2)}. Surtido parcial: ${shortages.join("; ")}.` : "";
    return Response.json({ ok: true, reference, saleId, movementIds, lineCount: lines.length, totalAmount, warning }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
