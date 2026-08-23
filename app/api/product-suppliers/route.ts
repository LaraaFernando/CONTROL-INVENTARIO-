import { env } from "cloudflare:workers";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { ensureProductSupplierSchema } from "../../product-suppliers";
import { recordAudit } from "../../../db/operations";

function text(value: unknown) { return String(value ?? "").trim(); }
function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  return Response.json({ error: error instanceof Error ? error.message : "No se pudo guardar el proveedor del producto." }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    if (!user.permissions["suppliers.manage"] && !user.permissions["orders.manage"]) {
      throw new AuthError("No tienes permiso para consultar proveedores por producto.", 403);
    }
    await ensureProductSupplierSchema();
    const [suppliers, products] = await Promise.all([
      env.DB.prepare(`SELECT id, name FROM suppliers WHERE active=1 ORDER BY name`).all<{id:number;name:string}>(),
      env.DB.prepare(`
        SELECT p.id, p.sku, p.name, p.cost,
          ps.supplier_id AS supplierId, s.name AS supplierName,
          COALESCE(ps.preferred,0) AS preferred,
          COALESCE(ps.supplier_product_code,'') AS supplierProductCode,
          COALESCE(ps.last_unit_cost,0) AS lastUnitCost,
          COALESCE(ps.lead_days,0) AS leadDays
        FROM products p
        LEFT JOIN product_suppliers ps ON ps.product_id=p.id AND ps.active=1 AND ps.preferred=1
        LEFT JOIN suppliers s ON s.id=ps.supplier_id AND s.active=1
        WHERE p.active=1
        ORDER BY p.name
      `).all(),
    ]);
    return Response.json({ suppliers: suppliers.results ?? [], products: products.results ?? [], singleSupplier: (suppliers.results ?? []).length === 1 });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "suppliers.manage");
    await ensureProductSupplierSchema();
    const body = await request.json() as Record<string, unknown>;
    const productId = Number(body.productId || 0);
    const supplierId = Number(body.supplierId || 0);
    const leadDays = Number(body.leadDays ?? 0);
    const lastUnitCost = Number(body.lastUnitCost ?? 0);
    const supplierProductCode = text(body.supplierProductCode);
    if (!productId || !supplierId) throw new AuthError("Producto y proveedor son obligatorios.", 400);
    if (!Number.isInteger(leadDays) || leadDays < 0) throw new AuthError("Los días de entrega deben ser un entero igual o mayor a cero.", 400);
    if (!Number.isFinite(lastUnitCost) || lastUnitCost < 0) throw new AuthError("El último costo no es válido.", 400);
    const [product, supplier, before] = await Promise.all([
      env.DB.prepare("SELECT id, sku, name FROM products WHERE id=? AND active=1 LIMIT 1").bind(productId).first<{id:number;sku:string;name:string}>(),
      env.DB.prepare("SELECT id, name FROM suppliers WHERE id=? AND active=1 LIMIT 1").bind(supplierId).first<{id:number;name:string}>(),
      env.DB.prepare(`SELECT ps.*, s.name AS supplierName FROM product_suppliers ps LEFT JOIN suppliers s ON s.id=ps.supplier_id WHERE ps.product_id=? AND ps.preferred=1 AND ps.active=1 LIMIT 1`).bind(productId).first(),
    ]);
    if (!product) throw new AuthError("Producto no encontrado.", 404);
    if (!supplier) throw new AuthError("Proveedor no encontrado.", 404);

    await env.DB.batch([
      env.DB.prepare("UPDATE product_suppliers SET preferred=0, updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND active=1").bind(productId),
      env.DB.prepare(`
        INSERT INTO product_suppliers
          (product_id,supplier_id,preferred,supplier_product_code,last_unit_cost,lead_days,active,updated_at)
        VALUES (?,?,1,?,?,?,1,CURRENT_TIMESTAMP)
        ON CONFLICT(product_id,supplier_id) DO UPDATE SET
          preferred=1,
          supplier_product_code=excluded.supplier_product_code,
          last_unit_cost=excluded.last_unit_cost,
          lead_days=excluded.lead_days,
          active=1,
          updated_at=CURRENT_TIMESTAMP
      `).bind(productId, supplierId, supplierProductCode, lastUnitCost, leadDays),
    ]);

    await recordAudit({
      entityType: "product_supplier",
      entityId: productId,
      action: "asignar_preferido",
      user,
      before,
      after: { productId, sku: product.sku, productName: product.name, supplierId, supplierName: supplier.name, supplierProductCode, lastUnitCost, leadDays },
    });
    return Response.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
