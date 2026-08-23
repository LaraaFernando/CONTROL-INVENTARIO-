import { eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { getDb } from "../../../db";
import { ensureOperationalSchema } from "../../../db/operations";
import { clients, products } from "../../../db/schema";
import { AuthError, requirePermission, requireUser } from "../../auth";

function errorResponse(error: unknown) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "No se pudo preparar la venta." },
    { status: 500 },
  );
}

export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    requirePermission(user, "movements.sale");
    await ensureOperationalSchema();
    const db = getDb();

    const [productRows, clientRows, movementResult] = await Promise.all([
      db.select().from(products).where(eq(products.active, 1)).orderBy(products.name),
      db.select().from(clients).where(eq(clients.active, 1)).orderBy(clients.name),
      env.DB.prepare(`
        SELECT
          id,
          type,
          product_id AS productId,
          voided,
          created_at AS createdAt
        FROM movements
        WHERE type = 'venta'
        ORDER BY id DESC
        LIMIT 200
      `).all<{
        id: number;
        type: string;
        productId: number;
        voided: number;
        createdAt: string;
      }>(),
    ]);

    return Response.json({
      products: productRows,
      clients: clientRows,
      movements: movementResult.results ?? [],
      auth: user,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
