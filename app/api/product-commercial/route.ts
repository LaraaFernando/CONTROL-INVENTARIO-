import { env } from "cloudflare:workers";
import { assertBusinessDateOpen, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { normalizeCommercialUnit, validBoxFactor } from "../../commercial-units";

function text(value: unknown) {
  return String(value ?? "").trim();
}

function nonNegativeInteger(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function nonNegativeAmount(value: unknown, fallback = 0) {
  const number = Number(value ?? fallback);
  return Number.isFinite(number) && number >= 0 ? Math.round((number + Number.EPSILON) * 100) / 100 : null;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  const message = error instanceof Error ? error.message : "Error inesperado";
  if (message.includes("UNIQUE constraint failed")) return Response.json({ error: "Ese código ya está registrado." }, { status: 409 });
  return Response.json({ error: message }, { status: 500 });
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const body = await request.json() as Record<string, unknown>;
    const action = text(body.action);

    if (action !== "add" && action !== "edit") throw new AuthError("Acción no válida.", 400);
    requirePermission(user, action === "add" ? "products.create" : "products.edit");

    const id = Number(body.id || 0);
    const sku = text(body.sku).toUpperCase();
    const name = text(body.name);
    const category = text(body.category) || "General";
    const unit = normalizeCommercialUnit(text(body.unit));
    const cost = nonNegativeAmount(body.cost);
    const salePrice = nonNegativeAmount(body.salePrice);
    const minimumStock = nonNegativeInteger(body.minimumStock);
    const targetStock = nonNegativeInteger(body.targetStock);
    const initialStock = action === "add" ? nonNegativeInteger(body.initialStock) : 0;
    const location = text(body.location);
    const rawBoxFactor = Number(body.boxFactor ?? 0);
    const boxFactor = rawBoxFactor === 0 || rawBoxFactor === 1 ? 0 : validBoxFactor(rawBoxFactor);

    if (!sku || !name) throw new AuthError("Código y nombre del producto son obligatorios.", 400);
    if (cost === null || salePrice === null || minimumStock === null || targetStock === null || initialStock === null) {
      throw new AuthError("Existencias, mínimos, meta, costo y precio deben tener valores válidos.", 400);
    }
    if (rawBoxFactor < 0 || (rawBoxFactor > 1 && !boxFactor)) {
      throw new AuthError("Las unidades por caja deben ser un número entero mayor a 1, o 0 si el producto no se maneja por caja.", 400);
    }

    if (action === "add") {
      if (initialStock > 0) await assertBusinessDateOpen(businessDate());
      const result = await env.DB.prepare(`
        INSERT INTO products
        (sku, name, category, unit, cost, sale_price, current_stock, minimum_stock,
          location, target_stock, set_factor, box_factor, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 1)
      `).bind(
        sku, name, category, unit, cost, salePrice, initialStock, minimumStock,
        location, targetStock, boxFactor,
      ).run();
      const productId = Number(result.meta.last_row_id);

      if (initialStock > 0) {
        await env.DB.prepare(`
          INSERT INTO movements
          (product_id, type, quantity, delta, reference, notes, performed_by,
            unit_amount, total_amount, requested_quantity, pending_quantity,
            presentation, presentation_factor, performed_by_user_id, business_date)
          VALUES (?, 'inventario_inicial', ?, ?, 'ALTA', ?, ?, ?, ?, ?, 0, ?, 1, ?, ?)
        `).bind(
          productId,
          initialStock,
          initialStock,
          `Inventario inicial en ${unit}`,
          user.displayName,
          cost,
          cost * initialStock,
          initialStock,
          unit,
          user.id,
          businessDate(),
        ).run();
      }

      await recordAudit({
        entityType: "product",
        entityId: productId,
        action: "crear",
        user,
        after: { sku, name, category, unit, cost, salePrice, initialStock, minimumStock, targetStock, boxFactor },
      });
      return Response.json({ ok: true, id: productId }, { status: 201 });
    }

    if (!id) throw new AuthError("Producto inválido.", 400);
    const before = await env.DB.prepare("SELECT * FROM products WHERE id=? AND active=1 LIMIT 1").bind(id).first<{
      id: number; cost: number;
    }>();
    if (!before) throw new AuthError("Producto no encontrado.", 404);

    const effectiveCost = user.permissions["products.view_cost"] ? cost : Number(before.cost || 0);
    await env.DB.prepare(`
      UPDATE products
      SET sku=?, name=?, category=?, unit=?, cost=?, sale_price=?, minimum_stock=?,
        location=?, target_stock=?, set_factor=1, box_factor=?
      WHERE id=? AND active=1
    `).bind(
      sku, name, category, unit, effectiveCost, salePrice, minimumStock,
      location, targetStock, boxFactor, id,
    ).run();

    await recordAudit({
      entityType: "product",
      entityId: id,
      action: "modificar",
      user,
      before,
      after: { sku, name, category, unit, cost: effectiveCost, salePrice, minimumStock, targetStock, boxFactor, commercialModel: "base_unit_plus_optional_box" },
    });

    return Response.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
