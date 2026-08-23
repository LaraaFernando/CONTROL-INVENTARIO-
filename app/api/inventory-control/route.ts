import { env } from "cloudflare:workers";
import { assertBusinessDateOpen, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { normalizeCommercialUnit, presentationFactor, unitLabel } from "../../commercial-units";

type ProductRow = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  cost: number;
  current_stock: number;
  box_factor: number;
};

type CountAudit = { previousStock?: number; physicalStock?: number; difference?: number };

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo completar la operación." }, { status: 500 });
}

async function activeProduct(productId: number) {
  return env.DB.prepare(`SELECT id, sku, name, unit, cost, current_stock, box_factor FROM products WHERE id=? AND active=1 LIMIT 1`)
    .bind(productId).first<ProductRow>();
}

async function insertMovement({ product, type, quantity, delta, presentation, presentationFactor: factor, reference, reason, userId, performedBy, movementDate }: {
  product: ProductRow; type: string; quantity: number; delta: number; presentation: string; presentationFactor: number; reference: string; reason: string; userId: number; performedBy: string; movementDate: string;
}) {
  const totalAmount = Math.abs(quantity) * Number(product.cost || 0);
  const result = await env.DB.prepare(`
    INSERT INTO movements
    (product_id, client_id, type, quantity, delta, reference, notes, performed_by, unit_amount, total_amount,
      requested_quantity, pending_quantity, presentation, presentation_factor, performed_by_user_id, business_date)
    VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)
  `).bind(product.id, type, Math.abs(quantity), delta, reference, reason, performedBy, Number(product.cost || 0), totalAmount, Math.abs(quantity), presentation, factor, userId, movementDate).run();
  return Number(result.meta.last_row_id);
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    if (!user.permissions["movements.adjust"] && !user.permissions["audit.view"]) return Response.json({ error: "No tienes permiso para consultar conteos físicos." }, { status: 403 });
    const result = await env.DB.prepare(`
      SELECT m.id, m.product_id AS productId, p.sku, p.name AS productName, p.unit,
        m.delta, m.notes AS reason, m.performed_by AS performedBy, m.created_at AS createdAt, a.after_json AS afterJson
      FROM movements m
      INNER JOIN products p ON p.id=m.product_id
      LEFT JOIN audit_events a ON a.entity_type='movement' AND a.entity_id=m.id AND a.action='conteo_fisico'
      WHERE m.type='conteo_fisico' AND m.voided=0
      ORDER BY m.id DESC LIMIT 20
    `).all<{ id:number; productId:number; sku:string; productName:string; unit:string; delta:number; reason:string; performedBy:string; createdAt:string; afterJson:string|null }>();
    const counts = (result.results ?? []).map(row => {
      let audit: CountAudit = {};
      try { audit = JSON.parse(row.afterJson || "{}") as CountAudit; } catch { audit = {}; }
      return { ...row, previousStock:Number(audit.previousStock ?? 0), physicalStock:Number(audit.physicalStock ?? 0), difference:Number(audit.difference ?? row.delta ?? 0) };
    });
    return Response.json({ counts });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const body = await request.json() as Record<string, unknown>;
    const action = String(body.action ?? "");
    const productId = Number(body.productId ?? 0);
    const reason = String(body.reason ?? "").trim();
    if (!productId) return Response.json({ error: "Selecciona un producto." }, { status: 400 });
    if (!reason) return Response.json({ error: "Escribe el motivo. CIV no permite cambios físicos sin explicación." }, { status: 400 });
    const product = await activeProduct(productId);
    if (!product) return Response.json({ error: "Producto no encontrado." }, { status: 404 });
    const baseUnit = normalizeCommercialUnit(product.unit);
    const movementDate = businessDate();
    await assertBusinessDateOpen(movementDate);

    if (action === "physical_count") {
      requirePermission(user, "movements.adjust");
      const physicalStock = Number(body.physicalStock);
      if (!Number.isInteger(physicalStock) || physicalStock < 0) return Response.json({ error: `El conteo físico debe ser un número entero de ${unitLabel(baseUnit, true)} igual o mayor a cero.` }, { status: 400 });
      const previousStock = Number(product.current_stock || 0);
      const difference = physicalStock - previousStock;
      const movementId = await insertMovement({ product, type:"conteo_fisico", quantity:Math.abs(difference), delta:difference, presentation:baseUnit, presentationFactor:1, reference:"CONTEO FÍSICO", reason, userId:user.id, performedBy:user.displayName, movementDate });
      if (difference !== 0) await env.DB.prepare("UPDATE products SET current_stock=? WHERE id=? AND active=1").bind(physicalStock, product.id).run();
      await recordAudit({ entityType:"movement", entityId:movementId, action:"conteo_fisico", user, before:{ previousStock }, after:{ previousStock, physicalStock, difference, productId, sku:product.sku, productName:product.name, unit:baseUnit }, reason });
      return Response.json({ ok:true, movementId, previousStock, physicalStock, difference, message:difference===0 ? "Conteo confirmado. El inventario físico coincide con CIV." : `Conteo confirmado. CIV ajustó la existencia de ${previousStock} a ${physicalStock} ${unitLabel(baseUnit, physicalStock !== 1)}.` });
    }

    if (action === "stock_incident") {
      const incident = String(body.incident ?? "").toLowerCase();
      if (!["sobrante","faltante","defectuoso"].includes(incident)) return Response.json({ error:"Selecciona un tipo de movimiento válido." }, { status:400 });
      if (incident === "defectuoso") requirePermission(user, "movements.defective"); else requirePermission(user, "movements.adjust");
      const presentations = Number(body.quantity ?? 0);
      if (!Number.isInteger(presentations) || presentations < 1) return Response.json({ error:"La cantidad debe ser un número entero mayor a cero." }, { status:400 });
      const presentation = String(body.presentation ?? baseUnit).toLowerCase();
      const factor = presentationFactor({ unit:baseUnit, boxFactor:Number(product.box_factor || 0) }, presentation);
      if (!factor) return Response.json({ error:`La presentación seleccionada no está configurada para ${product.name}.` }, { status:400 });
      const quantity = presentations * factor;
      const delta = incident === "sobrante" ? quantity : -quantity;
      const previousStock = Number(product.current_stock || 0);
      const newStock = previousStock + delta;
      if (newStock < 0) return Response.json({ error:`No hay suficiente existencia. Disponible: ${previousStock} ${unitLabel(baseUnit, previousStock !== 1)}.` }, { status:409 });
      const reference = incident === "sobrante" ? "SOBRANTE" : incident === "faltante" ? "FALTANTE" : "DAÑADO";
      const movementId = await insertMovement({ product, type:incident, quantity, delta, presentation, presentationFactor:factor, reference, reason, userId:user.id, performedBy:user.displayName, movementDate });
      await env.DB.prepare("UPDATE products SET current_stock=current_stock+? WHERE id=? AND active=1").bind(delta, product.id).run();
      await recordAudit({ entityType:"movement", entityId:movementId, action:"crear", user, after:{ productId, sku:product.sku, productName:product.name, type:incident, unit:baseUnit, presentations, presentation, presentationFactor:factor, quantity, previousStock, newStock }, reason });
      return Response.json({ ok:true, movementId, previousStock, newStock, quantity, message:`${reference}: ${quantity} ${unitLabel(baseUnit, quantity !== 1)} registradas. Existencia: ${previousStock} → ${newStock}.` });
    }
    return Response.json({ error:"Acción no válida." }, { status:400 });
  } catch (error) { return errorResponse(error); }
}
