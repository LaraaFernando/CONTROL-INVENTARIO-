import { and, desc, eq, lte } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { clients, creditNotes, products } from "../../../db/schema";
import {
  AuthError,
  PermissionKey,
  requirePermission,
  requireUser,
} from "../../auth";

const positiveTypes = new Set([
  "inventario_inicial",
  "entrada_compra",
  "devolucion_cliente",
  "ajuste_positivo",
]);

const negativeTypes = new Set([
  "venta",
  "defectuoso",
  "devolucion_proveedor",
  "ajuste_negativo",
]);

const movementPermission: Record<string, PermissionKey> = {
  entrada_compra: "movements.purchase",
  venta: "movements.sale",
  defectuoso: "movements.defective",
  devolucion_cliente: "movements.returns",
  devolucion_proveedor: "movements.returns",
  ajuste_positivo: "movements.adjust",
  ajuste_negativo: "movements.adjust",
};

type MovementRow = {
  id: number;
  type: string;
  quantity: number;
  delta: number;
  reference: string;
  notes: string;
  performedBy: string;
  voided: number;
  voidedBy: string;
  voidedAt: string | null;
  createdAt: string;
  productId: number;
  productName: string;
  sku: string;
  clientName: string | null;
  unitAmount: number;
  totalAmount: number;
  requestedQuantity: number;
  pendingQuantity: number;
  presentation: string;
  presentationFactor: number;
  businessDate: string;
};

function message(error: unknown) {
  if (error instanceof AuthError) return error.message;

  const text =
    error instanceof Error ? error.message : "Error inesperado";

  if (text.includes("no such table")) {
    return "La base de datos aún no está inicializada.";
  }

  if (text.includes("UNIQUE constraint failed")) {
    return "El SKU o folio ya está registrado.";
  }

  return text;
}

function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json(
      { error: error.message },
      { status: error.status },
    );
  }

  return Response.json(
    { error: message(error) },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const db = getDb();

    const [
      productRows,
      clientRows,
      movementResult,
      creditRows,
      lowStockRows,
    ] = await Promise.all([
      db
        .select()
        .from(products)
        .where(eq(products.active, 1))
        .orderBy(products.name),

      db
        .select()
        .from(clients)
        .where(eq(clients.active, 1))
        .orderBy(clients.name),

      env.DB.prepare(`
        SELECT
          m.id,
          m.type,
          m.quantity,
          m.delta,
          m.reference,
          m.notes,
          m.performed_by AS performedBy,
          m.voided,
          m.voided_by AS voidedBy,
          m.voided_at AS voidedAt,
          m.created_at AS createdAt,
          m.product_id AS productId,
          p.name AS productName,
          p.sku AS sku,
          c.name AS clientName,
          m.unit_amount AS unitAmount,
          m.total_amount AS totalAmount
          ,m.requested_quantity AS requestedQuantity
          ,m.pending_quantity AS pendingQuantity
          ,m.presentation
          ,m.presentation_factor AS presentationFactor
          ,m.business_date AS businessDate
        FROM movements m
        INNER JOIN products p
          ON p.id = m.product_id
        LEFT JOIN clients c
          ON c.id = m.client_id
        ORDER BY m.id DESC
        LIMIT 200
      `).all<MovementRow>(),

      db
        .select({
          id: creditNotes.id,
          folio: creditNotes.folio,
          saleReference: creditNotes.saleReference,
          amount: creditNotes.amount,
          reason: creditNotes.reason,
          status: creditNotes.status,
          notes: creditNotes.notes,
          createdAt: creditNotes.createdAt,
          clientId: clients.id,
          clientName: clients.name,
        })
        .from(creditNotes)
        .innerJoin(
          clients,
          eq(creditNotes.clientId, clients.id),
        )
        .where(eq(creditNotes.active, 1))
        .orderBy(desc(creditNotes.id))
        .limit(200),

      db
        .select()
        .from(products)
        .where(
          and(
            eq(products.active, 1),
            lte(
              products.currentStock,
              products.minimumStock,
            ),
          ),
        )
        .orderBy(products.currentStock),
    ]);

    const movementRows = movementResult.results ?? [];

    const canSeeCost =
      user.permissions["products.view_cost"];

    const safeProducts = productRows.map((product) =>
      canSeeCost
        ? product
        : {
            ...product,
            cost: 0,
          },
    );

    const safeLowStock = lowStockRows.map((product) =>
      canSeeCost
        ? product
        : {
            ...product,
            cost: 0,
          },
    );

    const inventoryValue = canSeeCost
      ? productRows.reduce(
          (sum, product) =>
            sum +
            product.cost *
              product.currentStock,
          0,
        )
      : null;

    const today = businessDate();

    const activeMovements = movementRows.filter(
      (movement) => !movement.voided,
    );

    const todayMovements = activeMovements.filter(
      (movement) =>
        (movement.businessDate || movement.createdAt.slice(0, 10)) === today,
    );

    const todaySales = todayMovements
      .filter(
        (movement) =>
          movement.type === "venta",
      )
      .reduce(
        (sum, movement) =>
          sum + Number(movement.totalAmount || 0),
        0,
      );

    const todayPurchases = todayMovements
      .filter(
        (movement) =>
          movement.type === "entrada_compra",
      )
      .reduce(
        (sum, movement) =>
          sum + Number(movement.totalAmount || 0),
        0,
      );

    const todayCredits = creditRows
      .filter(
        (note) =>
          note.createdAt.slice(0, 10) === today &&
          note.status !== "Cancelada",
      )
      .reduce(
        (sum, note) =>
          sum + Number(note.amount || 0),
        0,
      );

    return Response.json({
      products: safeProducts,
      clients: clientRows,
      movements: movementRows,
      creditNotes: creditRows,
      lowStock: safeLowStock,

      summary: {
        productCount: productRows.length,

        units: productRows.reduce(
          (sum, product) =>
            sum + product.currentStock,
          0,
        ),

        inventoryValue,

        todayMovements:
          todayMovements.length,

        todaySales,

        todayPurchases,

        todayCredits,
      },

      auth: user,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await ensureOperationalSchema();
    const db = getDb();

    const body =
      (await request.json()) as Record<
        string,
        unknown
      >;

    const action = String(
      body.action ?? "",
    );

    const performedBy =
      user.displayName;

    // ==============================
    // PRODUCTOS
    // ==============================

    if (action === "add_product") {
      requirePermission(
        user,
        "products.create",
      );

      const sku = String(
        body.sku ?? "",
      )
        .trim()
        .toUpperCase();

      const name = String(
        body.name ?? "",
      ).trim();

      const initialStock = Math.max(
        0,
        Math.floor(
          Number(body.initialStock ?? 0),
        ),
      );

      const category = String(
        body.category ?? "General",
      );

      const unit = String(
        body.unit ?? "pieza",
      );

      const cost = Math.max(
        0,
        Number(body.cost ?? 0),
      );

      const salePrice = Math.max(
        0,
        Number(body.salePrice ?? 0),
      );

      const minimumStock = Math.max(
        0,
        Math.floor(
          Number(
            body.minimumStock ?? 0,
          ),
        ),
      );

      const location = String(
        body.location ?? "",
      );

      const targetStock = Math.max(0, Math.floor(Number(body.targetStock ?? 0)));
      const setFactor = Math.max(1, Math.floor(Number(body.setFactor ?? 1)));
      const boxFactor = Math.max(1, Math.floor(Number(body.boxFactor ?? 1)));

      if (!sku || !name) {
        return Response.json(
          {
            error:
              "SKU y producto son obligatorios.",
          },
          { status: 400 },
        );
      }

      const result =
        await env.DB.prepare(`
          INSERT INTO products
          (
            sku,
            name,
            category,
            unit,
            cost,
            sale_price,
            current_stock,
            minimum_stock,
            location,
            target_stock,
            set_factor,
            box_factor,
            active
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
        `)
          .bind(
            sku,
            name,
            category,
            unit,
            cost,
            salePrice,
            initialStock,
            minimumStock,
            location,
            targetStock,
            setFactor,
            boxFactor,
          )
          .run();

      const productId = Number(
        result.meta.last_row_id,
      );

      if (initialStock > 0) {
        const totalAmount =
          cost * initialStock;

        await env.DB.prepare(`
          INSERT INTO movements
          (
            product_id,
            type,
            quantity,
            delta,
            reference,
            notes,
            performed_by,
            unit_amount,
            total_amount,
            requested_quantity,
            pending_quantity,
            presentation,
            presentation_factor,
            performed_by_user_id,
            business_date
          )
          VALUES
          (
            ?,
            'inventario_inicial',
            ?,
            ?,
            'ALTA',
            'Inventario al registrar el producto',
            ?,
            ?,
            ?,
            ?,
            0,
            'pieza',
            1,
            ?,
            ?
          )
        `)
          .bind(
            productId,
            initialStock,
            initialStock,
            performedBy,
            cost,
            totalAmount,
            initialStock,
            user.id,
            businessDate(),
          )
          .run();
      }

      await recordAudit({ entityType: "product", entityId: productId, action: "crear", user,
        after: { sku, name, initialStock, targetStock, setFactor, boxFactor } });

      return Response.json(
        { ok: true },
        { status: 201 },
      );
    }

    if (action === "edit_product") {
      requirePermission(
        user,
        "products.edit",
      );

      const id = Number(body.id);

      const sku = String(
        body.sku ?? "",
      )
        .trim()
        .toUpperCase();

      const name = String(
        body.name ?? "",
      ).trim();

      if (!id || !sku || !name) {
        return Response.json(
          {
            error:
              "Producto, SKU y nombre son obligatorios.",
          },
          { status: 400 },
        );
      }

      const [existing] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, id),
            eq(products.active, 1),
          ),
        )
        .limit(1);

      if (!existing) {
        return Response.json(
          {
            error:
              "Producto no encontrado.",
          },
          { status: 404 },
        );
      }

      await db
        .update(products)
        .set({
          sku,
          name,

          category: String(
            body.category ?? "General",
          ),

          unit: String(
            body.unit ?? "pieza",
          ),

          cost: user.permissions[
            "products.view_cost"
          ]
            ? Math.max(
                0,
                Number(
                  body.cost ??
                    existing.cost,
                ),
              )
            : existing.cost,

          salePrice: Math.max(
            0,
            Number(
              body.salePrice ??
                existing.salePrice,
            ),
          ),

          minimumStock: Math.max(
            0,
            Number(
              body.minimumStock ??
                existing.minimumStock,
            ),
          ),

          location: String(
            body.location ?? "",
          ),

          targetStock: Math.max(0, Math.floor(Number(body.targetStock ?? existing.targetStock))),
          setFactor: Math.max(1, Math.floor(Number(body.setFactor ?? existing.setFactor))),
          boxFactor: Math.max(1, Math.floor(Number(body.boxFactor ?? existing.boxFactor))),
        })
        .where(
          and(
            eq(products.id, id),
            eq(products.active, 1),
          ),
        );

      await recordAudit({ entityType: "product", entityId: id, action: "modificar", user,
        before: existing, after: { sku, name, targetStock: body.targetStock, setFactor: body.setFactor, boxFactor: body.boxFactor } });

      return Response.json({
        ok: true,
      });
    }

    if (action === "delete_product") {
      requirePermission(
        user,
        "products.delete",
      );

      const id = Number(body.id);

      if (!id) {
        return Response.json(
          {
            error:
              "Producto inválido.",
          },
          { status: 400 },
        );
      }

      await db
        .update(products)
        .set({
          active: 0,
        })
        .where(eq(products.id, id));

      await recordAudit({ entityType: "product", entityId: id, action: "desactivar", user, after: { active: false } });

      return Response.json({
        ok: true,
      });
    }

    // ==============================
    // CLIENTES
    // ==============================

    if (action === "add_client") {
      requirePermission(
        user,
        "clients.create",
      );

      const name = String(
        body.name ?? "",
      ).trim();

      if (!name) {
        return Response.json(
          {
            error:
              "El nombre del cliente es obligatorio.",
          },
          { status: 400 },
        );
      }

      const method = String(body.defaultPaymentMethod ?? "PUE").toUpperCase() === "PPD" ? "PPD" : "PUE";
      const result = await env.DB.prepare(`INSERT INTO clients
        (name, business_name, tax_id, phone, email, address, invoice_required,
          default_payment_method, credit_days, fiscal_postal_code, fiscal_regime, cfdi_use, active)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`)
        .bind(name, String(body.businessName ?? ""), String(body.taxId ?? "").toUpperCase(),
          String(body.phone ?? ""), String(body.email ?? ""), String(body.address ?? ""),
          body.invoiceRequired ? 1 : 0, method, method === "PUE" ? 0 : Math.max(1, Number(body.creditDays ?? 30)),
          String(body.fiscalPostalCode ?? ""), String(body.fiscalRegime ?? ""), String(body.cfdiUse ?? "G03")).run();
      const clientId = Number(result.meta.last_row_id);
      await recordAudit({ entityType: "client", entityId: clientId, action: "crear", user,
        after: { name, method, creditDays: body.creditDays } });

      return Response.json(
        { ok: true },
        { status: 201 },
      );
    }

    if (action === "edit_client") {
      requirePermission(
        user,
        "clients.edit",
      );

      const id = Number(body.id);

      const name = String(
        body.name ?? "",
      ).trim();

      if (!id || !name) {
        return Response.json(
          {
            error:
              "Cliente y nombre son obligatorios.",
          },
          { status: 400 },
        );
      }

      const before = await env.DB.prepare("SELECT * FROM clients WHERE id=? AND active=1 LIMIT 1").bind(id).first();
      if (!before) return Response.json({ error: "Cliente no encontrado." }, { status: 404 });
      const method = String(body.defaultPaymentMethod ?? "PUE").toUpperCase() === "PPD" ? "PPD" : "PUE";
      await env.DB.prepare(`UPDATE clients SET name=?, business_name=?, tax_id=?, phone=?, email=?, address=?,
        invoice_required=?, default_payment_method=?, credit_days=?, fiscal_postal_code=?, fiscal_regime=?, cfdi_use=?
        WHERE id=? AND active=1`)
        .bind(name, String(body.businessName ?? ""), String(body.taxId ?? "").toUpperCase(),
          String(body.phone ?? ""), String(body.email ?? ""), String(body.address ?? ""),
          body.invoiceRequired ? 1 : 0, method, method === "PUE" ? 0 : Math.max(1, Number(body.creditDays ?? 30)),
          String(body.fiscalPostalCode ?? ""), String(body.fiscalRegime ?? ""), String(body.cfdiUse ?? "G03"), id).run();
      await recordAudit({ entityType: "client", entityId: id, action: "modificar", user, before,
        after: { name, method, creditDays: body.creditDays } });

      return Response.json({
        ok: true,
      });
    }

    if (action === "delete_client") {
      requirePermission(
        user,
        "clients.delete",
      );

      const id = Number(body.id);

      if (!id) {
        return Response.json(
          {
            error:
              "Cliente inválido.",
          },
          { status: 400 },
        );
      }

      await db
        .update(clients)
        .set({
          active: 0,
        })
        .where(eq(clients.id, id));

      await recordAudit({ entityType: "client", entityId: id, action: "desactivar", user, after: { active: false } });

      return Response.json({
        ok: true,
      });
    }

    // ==============================
    // MOVIMIENTOS
    // ==============================

    if (action === "add_movement") {
      const productId = Number(
        body.productId,
      );

      const clientId = body.clientId
        ? Number(body.clientId)
        : null;

      const type = String(
        body.type ?? "",
      );

      const requestedPresentations = Math.max(
        1,
        Math.floor(
          Number(body.quantity ?? 0),
        ),
      );

      if (
        !productId ||
        (!positiveTypes.has(type) &&
          !negativeTypes.has(type)) ||
        type === "inventario_inicial"
      ) {
        return Response.json(
          {
            error:
              "Selecciona producto y tipo de movimiento.",
          },
          { status: 400 },
        );
      }

      const permission =
        movementPermission[type];

      if (!permission) {
        return Response.json(
          {
            error:
              "Tipo de movimiento no permitido.",
          },
          { status: 400 },
        );
      }

      requirePermission(
        user,
        permission,
      );

      const [product] = await db
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, productId),
            eq(products.active, 1),
          ),
        )
        .limit(1);

      if (!product) {
        return Response.json(
          {
            error:
              "Producto no encontrado.",
          },
          { status: 404 },
        );
      }

      const presentation = ["pieza", "unidad", "ciento", "juego", "caja"].includes(String(body.presentation))
        ? String(body.presentation)
        : "pieza";
      const presentationFactor = presentation === "ciento"
        ? 100
        : presentation === "juego"
          ? Math.max(1, product.setFactor)
          : presentation === "caja"
            ? Math.max(1, product.boxFactor)
            : 1;
      const requestedQuantity = requestedPresentations * presentationFactor;
      const quantity = type === "venta"
        ? Math.min(requestedQuantity, product.currentStock)
        : requestedQuantity;
      const pendingQuantity = type === "venta" ? requestedQuantity - quantity : 0;

      if (type === "venta" && quantity === 0) {
        return Response.json(
          { error: `No hay existencia disponible. Faltan ${requestedQuantity} unidades base para surtir la solicitud.` },
          { status: 409 },
        );
      }

      const delta = positiveTypes.has(
        type,
      )
        ? quantity
        : -quantity;

      const newStock =
        product.currentStock + delta;

      if (newStock < 0) {
        return Response.json(
          {
            error: `No hay suficiente existencia. Disponible: ${product.currentStock}.`,
          },
          { status: 400 },
        );
      }

      /*
       * VALOR ECONÓMICO
       *
       * Venta y devolución de cliente:
       * precio de venta.
       *
       * Compras, defectuosos,
       * devolución a proveedor y ajustes:
       * costo.
       */
      let unitAmount = product.cost;

      if (
        type === "venta" ||
        type === "devolucion_cliente"
      ) {
        unitAmount =
          product.salePrice;
      }

      const totalAmount =
        unitAmount * quantity;

      const batchResult = await env.DB.batch([
        env.DB.prepare(`
          INSERT INTO movements
          (
            product_id,
            client_id,
            type,
            quantity,
            delta,
            reference,
            notes,
            performed_by,
            unit_amount,
            total_amount,
            requested_quantity,
            pending_quantity,
            presentation,
            presentation_factor,
            performed_by_user_id,
            business_date
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          productId,
          clientId,
          type,
          quantity,
          delta,
          String(body.reference ?? ""),
          String(body.notes ?? ""),
          performedBy,
          unitAmount,
          totalAmount,
          requestedQuantity,
          pendingQuantity,
          presentation,
          presentationFactor,
          user.id,
          businessDate(),
        ),

        env.DB.prepare(`
          UPDATE products
          SET current_stock = ?
          WHERE id = ?
        `).bind(
          newStock,
          productId,
        ),
      ]);

      const movementId = Number(batchResult[0].meta.last_row_id);
      await recordAudit({
        entityType: "movement",
        entityId: movementId,
        action: "crear",
        user,
        after: {
          productId,
          type,
          requestedQuantity,
          fulfilledQuantity: quantity,
          pendingQuantity,
          presentation,
          presentationFactor,
          previousStock: product.currentStock,
          newStock,
          unitAmount,
          totalAmount,
        },
      });

      return Response.json(
        {
          ok: true,
          movementId,
          fulfilledQuantity: quantity,
          pendingQuantity,
          warning: pendingQuantity > 0
            ? `Existencia insuficiente: se surtieron ${quantity} unidades base y quedan ${pendingQuantity} pendientes.`
            : "",
        },
        { status: 201 },
      );
    }

    if (action === "void_movement") {
      requirePermission(
        user,
        "movements.delete",
      );

      const id = Number(body.id);
      const reason = String(body.reason ?? "").trim();

      if (!id || !reason) {
        return Response.json(
          {
            error:
              "Movimiento inválido o motivo de anulación faltante.",
          },
          { status: 400 },
        );
      }

      const movement =
        await env.DB.prepare(`
          SELECT
            id,
            product_id,
            delta,
            voided
          FROM movements
          WHERE id = ?
          LIMIT 1
        `)
          .bind(id)
          .first<{
            id: number;
            product_id: number;
            delta: number;
            voided: number;
          }>();

      if (!movement) {
        return Response.json(
          {
            error:
              "Movimiento no encontrado.",
          },
          { status: 404 },
        );
      }

      if (movement.voided) {
        return Response.json(
          {
            error:
              "Ese movimiento ya fue anulado.",
          },
          { status: 409 },
        );
      }

      const product =
        await env.DB.prepare(`
          SELECT current_stock
          FROM products
          WHERE id = ?
          LIMIT 1
        `)
          .bind(
            movement.product_id,
          )
          .first<{
            current_stock: number;
          }>();

      if (!product) {
        return Response.json(
          {
            error:
              "Producto relacionado no encontrado.",
          },
          { status: 404 },
        );
      }

      const correctedStock =
        Number(
          product.current_stock,
        ) -
        Number(movement.delta);

      if (correctedStock < 0) {
        return Response.json(
          {
            error:
              "No se puede anular porque dejaría el inventario en negativo. Corrige primero movimientos posteriores.",
          },
          { status: 409 },
        );
      }

      await env.DB.batch([
        env.DB.prepare(`
          UPDATE products
          SET current_stock = ?
          WHERE id = ?
        `).bind(
          correctedStock,
          movement.product_id,
        ),

        env.DB.prepare(`
          UPDATE movements
          SET
            voided = 1,
            voided_by = ?,
            voided_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).bind(
          performedBy,
          id,
        ),
      ]);

      await recordAudit({
        entityType: "movement",
        entityId: id,
        action: "anular",
        user,
        before: movement,
        after: { voided: true, correctedStock },
        reason,
      });

      return Response.json({
        ok: true,
      });
    }

    // ==============================
    // NOTAS DE CRÉDITO
    // ==============================

    if (action === "add_credit_note") {
      requirePermission(
        user,
        "credit_notes.create",
      );

      const folio = String(
        body.folio ?? "",
      )
        .trim()
        .toUpperCase();

      const clientId = Number(
        body.clientId,
      );

      const amount = Number(
        body.amount ?? 0,
      );

      const reason = String(
        body.reason ?? "",
      ).trim();

      if (
        !folio ||
        !clientId ||
        amount <= 0 ||
        !reason
      ) {
        return Response.json(
          {
            error:
              "Folio, cliente, importe y motivo son obligatorios.",
          },
          { status: 400 },
        );
      }

      const result = await env.DB.prepare(`INSERT INTO credit_notes
        (folio, client_id, amount, reason, sale_reference, status, notes, active)
        VALUES (?, ?, ?, ?, ?, 'Pendiente', ?, 1)`)
        .bind(folio, clientId, amount, reason, String(body.saleReference ?? ""), String(body.notes ?? "")).run();
      const creditId = Number(result.meta.last_row_id);
      await recordAudit({ entityType: "credit_note", entityId: creditId, action: "crear", user,
        after: { folio, clientId, amount, reason } });

      return Response.json(
        { ok: true },
        { status: 201 },
      );
    }

    if (
      action ===
      "update_credit_status"
    ) {
      requirePermission(
        user,
        "credit_notes.status",
      );

      const id = Number(body.id);

      const status = String(
        body.status ?? "",
      );

      if (
        !id ||
        ![
          "Pendiente",
          "Aplicada",
          "Cancelada",
        ].includes(status)
      ) {
        return Response.json(
          {
            error:
              "Datos inválidos.",
          },
          { status: 400 },
        );
      }

      const before = await env.DB.prepare("SELECT * FROM credit_notes WHERE id=? LIMIT 1").bind(id).first();
      await db
        .update(creditNotes)
        .set({
          status,
        })
        .where(
          and(
            eq(creditNotes.id, id),
            eq(creditNotes.active, 1),
          ),
        );

      await recordAudit({ entityType: "credit_note", entityId: id, action: "estatus", user, before, after: { status } });

      return Response.json({
        ok: true,
      });
    }

    if (
      action ===
      "delete_credit_note"
    ) {
      requirePermission(
        user,
        "credit_notes.delete",
      );

      const id = Number(body.id);
      const reason = String(body.reason ?? "").trim();

      if (!id || !reason) {
        return Response.json(
          {
            error:
              "Nota de crédito inválida o motivo de cancelación faltante.",
          },
          { status: 400 },
        );
      }

      await env.DB.prepare(`
        UPDATE credit_notes
        SET
          active = 1,
          status = 'Cancelada',
          voided_by = ?,
          voided_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `)
        .bind(
          performedBy,
          id,
        )
        .run();

      await recordAudit({ entityType: "credit_note", entityId: id, action: "cancelar", user,
        after: { status: "Cancelada" }, reason });

      return Response.json({
        ok: true,
      });
    }

    return Response.json(
      {
        error:
          "Acción no reconocida.",
      },
      { status: 400 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
