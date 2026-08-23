import { env } from "cloudflare:workers";
import { assertBusinessDateOpen, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, type PermissionKey, requirePermission, requireUser } from "../../auth";
import { normalizeCommercialUnit, presentationFactor, unitLabel } from "../../commercial-units";

const positive = new Set(["entrada_compra", "devolucion_cliente", "ajuste_positivo"]);
const negative = new Set(["devolucion_proveedor", "ajuste_negativo"]);
const permissions: Record<string, PermissionKey> = {
  entrada_compra: "movements.purchase",
  devolucion_cliente: "movements.returns",
  devolucion_proveedor: "movements.returns",
  ajuste_positivo: "movements.adjust",
  ajuste_negativo: "movements.adjust",
};

function text(value: unknown) { return String(value ?? "").trim(); }
function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo registrar el movimiento." }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const body = await request.json() as Record<string, unknown>;
    const type = text(body.type);
    const permission = permissions[type];
    if (!permission || (!positive.has(type) && !negative.has(type))) throw new AuthError("Tipo de movimiento no válido.", 400);
    requirePermission(user, permission);
    const productId = Number(body.productId || 0);
    const presentations = Number(body.quantity || 0);
    if (!productId || !Number.isInteger(presentations) || presentations < 1) throw new AuthError("Selecciona producto y una cantidad entera mayor a cero.", 400);
    const product = await env.DB.prepare(`SELECT id, sku, name, unit, cost, sale_price AS salePrice, current_stock AS currentStock, box_factor AS boxFactor FROM products WHERE id=? AND active=1 LIMIT 1`)
      .bind(productId).first<{ id:number; sku:string; name:string; unit:string; cost:number; salePrice:number; currentStock:number; boxFactor:number }>();
    if (!product) throw new AuthError("Producto no encontrado.", 404);
    const baseUnit = normalizeCommercialUnit(product.unit);
    const presentation = text(body.presentation).toLowerCase() || baseUnit;
    const factor = presentationFactor(product, presentation);
    if (!factor) throw new AuthError(`La presentación seleccionada no está configurada para ${product.name}.`, 400);
    const quantity = presentations * factor;
    const delta = positive.has(type) ? quantity : -quantity;
    const newStock = Number(product.currentStock) + delta;
    if (newStock < 0) throw new AuthError(`No hay suficiente existencia. Disponible: ${product.currentStock} ${unitLabel(baseUnit, product.currentStock !== 1)}.`, 409);
    const movementDate = businessDate();
    await assertBusinessDateOpen(movementDate);
    const clientId = body.clientId ? Number(body.clientId) : null;
    if (clientId) {
      const client = await env.DB.prepare("SELECT id FROM clients WHERE id=? AND active=1 LIMIT 1").bind(clientId).first();
      if (!client) throw new AuthError("Cliente no encontrado.", 404);
    }
    const unitAmount = type === "devolucion_cliente" ? Number(product.salePrice || 0) : Number(product.cost || 0);
    const totalAmount = unitAmount * quantity;
    const results = await env.DB.batch([
      env.DB.prepare(`INSERT INTO movements
        (product_id, client_id, type, quantity, delta, reference, notes, performed_by, unit_amount, total_amount,
          requested_quantity, pending_quantity, presentation, presentation_factor, performed_by_user_id, business_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`)
        .bind(productId, clientId, type, quantity, delta, text(body.reference), text(body.notes), user.displayName, unitAmount, totalAmount, quantity, presentation, factor, user.id, movementDate),
      env.DB.prepare("UPDATE products SET current_stock=current_stock+? WHERE id=?").bind(delta, productId),
    ]);
    const movementId = Number(results[0].meta.last_row_id);
    await recordAudit({ entityType:"movement", entityId:movementId, action:"crear", user, after:{ productId, sku:product.sku, productName:product.name, type, unit:baseUnit, presentations, presentation, presentationFactor:factor, quantity, previousStock:product.currentStock, newStock, unitAmount, totalAmount } });
    return Response.json({ ok:true, movementId, newStock, message:`Movimiento registrado: ${quantity} ${unitLabel(baseUnit, quantity !== 1)}.` }, { status:201 });
  } catch (error) { return errorResponse(error); }
}
