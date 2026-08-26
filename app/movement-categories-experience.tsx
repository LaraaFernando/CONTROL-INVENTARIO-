"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { MovementAuditDialog } from "./operations-app";

type Movement = {
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
  voidReason: string;
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

type OrderHistory = {
  id: number;
  folio: string;
  status: string;
  totalAmount: number;
  notes: string;
  createdBy: string;
  businessDate: string;
  createdAt: string;
  canceledAt: string | null;
  canceledReason: string;
  updatedBy: string;
  clientName: string;
  lineCount: number;
  totalQuantity: number;
};

type HistoryData = {
  rows: Movement[];
  orders: OrderHistory[];
  orderSummary?: { active: number; canceled: number };
  canDelete: boolean;
  canAudit: boolean;
  error?: string;
};

type Category = "ventas" | "ventas-anuladas" | "pedidos" | "pedidos-anulados" | "compras" | "devoluciones" | "ajustes";

type SaleGroup = {
  key: string;
  reference: string;
  clientName: string;
  rows: Movement[];
  activeRows: Movement[];
  voidedRows: Movement[];
  originalTotal: number;
  activeTotal: number;
  voidedTotal: number;
  fullyVoided: boolean;
  latestAt: string;
};

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const movementLabels: Record<string, string> = {
  inventario_inicial: "Inventario inicial",
  entrada_compra: "Entrada por compra",
  venta: "Venta",
  defectuoso: "Producto defectuoso",
  devolucion_cliente: "Devolución de cliente",
  devolucion_proveedor: "Devolución a proveedor",
  ajuste_positivo: "Ajuste positivo",
  ajuste_negativo: "Ajuste negativo",
};
const orderStatusLabels: Record<string, string> = {
  levantado: "Pedido levantado",
  preparando: "Preparando",
  transito: "En tránsito",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

function dateTime(value: string | null | undefined) {
  if (!value) return "—";
  const normalized = value.includes("T") ? value : value.replace(" ", "T") + "Z";
  try {
    return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(normalized));
  } catch {
    return value;
  }
}

function groupKey(row: Movement) {
  return row.reference?.trim() || `MOV-${row.id}`;
}

function groupSales(rows: Movement[]) {
  const map = new Map<string, Movement[]>();
  rows.filter((row) => row.type === "venta").forEach((row) => {
    const key = groupKey(row);
    map.set(key, [...(map.get(key) ?? []), row]);
  });

  return Array.from(map.entries()).map(([key, saleRows]): SaleGroup => {
    const activeRows = saleRows.filter((row) => !row.voided);
    const voidedRows = saleRows.filter((row) => Boolean(row.voided));
    const timestamps = saleRows.map((row) => row.voidedAt || row.createdAt).filter(Boolean).sort();
    return {
      key,
      reference: saleRows[0]?.reference || key,
      clientName: saleRows.find((row) => row.clientName)?.clientName || "Sin cliente",
      rows: saleRows,
      activeRows,
      voidedRows,
      originalTotal: saleRows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0),
      activeTotal: activeRows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0),
      voidedTotal: voidedRows.reduce((sum, row) => sum + Number(row.totalAmount || 0), 0),
      fullyVoided: saleRows.length > 0 && activeRows.length === 0 && voidedRows.length > 0,
      latestAt: timestamps[timestamps.length - 1] || saleRows[0]?.createdAt || "",
    };
  }).sort((left, right) => right.latestAt.localeCompare(left.latestAt));
}

function CategoryButton({ title, note, count, onClick }: { title: string; note: string; count: number; onClick: () => void }) {
  return <button type="button" onClick={onClick} style={{
    display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", width: "100%",
    padding: 16, border: "1px solid var(--line)", borderRadius: 16, background: "var(--card)", color: "var(--text)", textAlign: "left",
  }}>
    <span><strong style={{ display: "block", fontSize: 17 }}>{title}</strong><small style={{ display: "block", marginTop: 4, color: "var(--muted)" }}>{note}</small></span>
    <b style={{ minWidth: 34, height: 34, display: "grid", placeItems: "center", borderRadius: 999, background: "var(--soft)" }}>{count}</b>
  </button>;
}

function LineDetails({ row, canDelete, canAudit, onVoid, onAudit }: {
  row: Movement;
  canDelete: boolean;
  canAudit: boolean;
  onVoid: (row: Movement) => void;
  onAudit: (id: number) => void;
}) {
  return <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "grid", gap: 8 }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
      <span style={{ minWidth: 0 }}><code>{row.sku}</code><strong style={{ display: "block", marginTop: 3 }}>{row.productName}</strong><small style={{ color: "var(--muted)" }}>{row.presentation || "pieza"} · {row.quantity} surtido{row.quantity === 1 ? "" : "s"}</small></span>
      <strong>{money.format(Number(row.totalAmount || 0))}</strong>
    </div>
    <small style={{ color: "var(--muted)" }}>Movimiento #{row.id} · {dateTime(row.createdAt)} · {row.performedBy || "—"}</small>
    {row.voided && <div className="field-note"><b>Anulado</b>{row.voidedBy ? ` por ${row.voidedBy}` : ""}{row.voidedAt ? ` · ${dateTime(row.voidedAt)}` : ""}{row.voidReason ? ` · Motivo: ${row.voidReason}` : ""}</div>}
    {(canAudit || (canDelete && !row.voided)) && <div className="row-actions">
      {canAudit && <button type="button" className="mini" onClick={() => onAudit(row.id)}>Auditoría</button>}
      {canDelete && !row.voided && <button type="button" className="mini danger" onClick={() => onVoid(row)}>Anular</button>}
    </div>}
  </div>;
}

function SaleCards({ groups, canceled, canDelete, canAudit, onVoid, onAudit }: {
  groups: SaleGroup[];
  canceled: boolean;
  canDelete: boolean;
  canAudit: boolean;
  onVoid: (row: Movement) => void;
  onAudit: (id: number) => void;
}) {
  const [openKeys, setOpenKeys] = useState<string[]>([]);
  const toggle = (key: string) => setOpenKeys((current) => current.includes(key) ? current.filter((value) => value !== key) : [...current, key]);

  if (!groups.length) return <div className="field-note">No hay registros en esta categoría.</div>;

  return <div style={{ display: "grid", gap: 12 }}>
    {groups.map((group) => {
      const open = openKeys.includes(group.key);
      const detailRows = canceled ? (group.fullyVoided ? group.rows : group.voidedRows) : group.activeRows;
      const latestCanceled = group.voidedRows.slice().sort((a, b) => (b.voidedAt || "").localeCompare(a.voidedAt || ""))[0];
      const title = canceled ? (group.fullyVoided ? "Venta completa anulada" : "Anulación parcial") : "Venta vigente";
      const amount = canceled ? (group.fullyVoided ? group.originalTotal : group.voidedTotal) : group.activeTotal;
      return <article key={group.key} style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--card)", overflow: "hidden" }}>
        <button type="button" onClick={() => toggle(group.key)} style={{ width: "100%", border: 0, background: "transparent", color: "var(--text)", textAlign: "left", padding: 15, display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
          <span>
            <small style={{ color: canceled ? "var(--danger)" : "var(--muted)", fontWeight: 800 }}>{title.toUpperCase()}</small>
            <strong style={{ display: "block", fontSize: 17, marginTop: 3 }}>{group.reference}</strong>
            <small style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>{group.clientName} · {detailRows.length} producto{detailRows.length === 1 ? "" : "s"}</small>
            {canceled && !group.fullyVoided && <small style={{ display: "block", marginTop: 5 }}>El resto de la venta sigue vigente por <b>{money.format(group.activeTotal)}</b>.</small>}
            {canceled && latestCanceled && <small style={{ display: "block", color: "var(--muted)", marginTop: 5 }}>{dateTime(latestCanceled.voidedAt || latestCanceled.createdAt)}{latestCanceled.voidedBy ? ` · ${latestCanceled.voidedBy}` : ""}</small>}
          </span>
          <span style={{ textAlign: "right" }}><b style={{ display: "block", fontSize: 18 }}>{money.format(amount)}</b><small style={{ color: "var(--muted)" }}>{open ? "Ocultar" : "Ver desglose"}</small></span>
        </button>
        {open && <div>
          {canceled && latestCanceled?.voidReason && <div className="field-note" style={{ margin: "0 12px 10px" }}><b>Motivo:</b> {latestCanceled.voidReason}</div>}
          {detailRows.map((row) => <LineDetails key={row.id} row={row} canDelete={canDelete} canAudit={canAudit} onVoid={onVoid} onAudit={onAudit} />)}
          {canceled && group.fullyVoided && <div style={{ padding: 12, borderTop: "1px solid var(--line)", display: "flex", justifyContent: "space-between", gap: 10 }}><strong>Total original de la venta</strong><strong>{money.format(group.originalTotal)}</strong></div>}
        </div>}
      </article>;
    })}
  </div>;
}

function OrderList({ rows, canceled }: { rows: OrderHistory[]; canceled: boolean }) {
  if (!rows.length) return <div className="field-note">No hay registros en esta categoría.</div>;
  return <div style={{ display: "grid", gap: 10 }}>
    {rows.map((row) => <article key={`${canceled ? "cancel" : "created"}-${row.id}`} style={{ border: "1px solid var(--line)", borderRadius: 16, background: "var(--card)", padding: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12 }}>
        <span>
          <small style={{ color: canceled ? "var(--danger)" : "var(--muted)", fontWeight: 800 }}>{canceled ? "PEDIDO ANULADO" : "PEDIDO REALIZADO"}</small>
          <code style={{ display: "block", fontWeight: 800, marginTop: 3 }}>{row.folio}</code>
          <strong style={{ display: "block", marginTop: 3 }}>{row.clientName}</strong>
          <small style={{ display: "block", color: "var(--muted)", marginTop: 4 }}>{row.lineCount} partida{row.lineCount === 1 ? "" : "s"} · {row.totalQuantity} unidad{row.totalQuantity === 1 ? "" : "es"}</small>
        </span>
        <span style={{ textAlign: "right" }}><strong style={{ display: "block", fontSize: 18 }}>{money.format(Number(row.totalAmount || 0))}</strong><small style={{ color: "var(--muted)" }}>{orderStatusLabels[row.status] || row.status}</small></span>
      </div>
      {!canceled && <div className="field-note" style={{ marginTop: 10 }}>Realizado {dateTime(row.createdAt)}{row.createdBy ? ` por ${row.createdBy}` : ""}.</div>}
      {canceled && <div className="field-note" style={{ marginTop: 10 }}><b>Anulado {dateTime(row.canceledAt)}</b>{row.updatedBy ? ` por ${row.updatedBy}` : ""}{row.canceledReason ? ` · Motivo: ${row.canceledReason}` : ""}</div>}
      {row.notes && <small style={{ display: "block", color: "var(--muted)", marginTop: 8 }}>Nota: {row.notes}</small>}
    </article>)}
  </div>;
}

function MovementList({ rows, canDelete, canAudit, onVoid, onAudit }: {
  rows: Movement[];
  canDelete: boolean;
  canAudit: boolean;
  onVoid: (row: Movement) => void;
  onAudit: (id: number) => void;
}) {
  if (!rows.length) return <div className="field-note">No hay registros en esta categoría.</div>;
  return <div style={{ display: "grid", gap: 10 }}>
    {rows.map((row) => <article key={row.id} style={{ border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", overflow: "hidden" }}>
      <div style={{ padding: 13, display: "grid", gridTemplateColumns: "1fr auto", gap: 10 }}>
        <span><small style={{ color: "var(--muted)", fontWeight: 800 }}>{movementLabels[row.type] || row.type}</small><strong style={{ display: "block", marginTop: 3 }}>{row.productName}</strong><small style={{ color: "var(--muted)" }}>{row.sku} · {row.reference || "Sin referencia"} · {dateTime(row.createdAt)}</small></span>
        <span style={{ textAlign: "right" }}><b style={{ display: "block" }}>{row.delta > 0 ? "+" : ""}{row.delta}</b><small>{money.format(Number(row.totalAmount || 0))}</small></span>
      </div>
      <LineDetails row={row} canDelete={canDelete} canAudit={canAudit} onVoid={onVoid} onAudit={onAudit} />
    </article>)}
  </div>;
}

export default function MovementCategoriesExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<HistoryData | null>(null);
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [auditMovement, setAuditMovement] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/movement-history", { cache: "no-store" });
      const json = await response.json() as HistoryData;
      if (!response.ok) throw new Error(json.error || "No se pudo cargar el historial clasificado.");
      setData(json);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el historial clasificado.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const restoreLegacy = () => {
      document.querySelectorAll<HTMLElement>("[data-civ-movements-legacy-hidden='1']").forEach((element) => {
        element.style.display = "";
        delete element.dataset.civMovementsLegacyHidden;
      });
    };

    const sync = () => {
      const content = document.querySelector<HTMLElement>(".content");
      const heading = content?.querySelector<HTMLElement>(":scope > header h1")?.textContent?.trim();
      if (!content || heading !== "Movimientos") {
        restoreLegacy();
        setMount((current) => current ? null : current);
        setCategory(null);
        return;
      }

      const legacyHeading = Array.from(content.querySelectorAll<HTMLElement>("h2")).find((element) => element.textContent?.trim() === "Historial de movimientos y ventas");
      const legacy = legacyHeading?.closest<HTMLElement>("section.card.fill");
      if (legacy) {
        legacy.style.display = "none";
        legacy.dataset.civMovementsLegacyHidden = "1";
      }

      let target = content.querySelector<HTMLElement>("[data-civ-movement-categories-mount]");
      if (!target) {
        target = document.createElement("div");
        target.dataset.civMovementCategoriesMount = "1";
        const header = content.querySelector(":scope > header");
        if (header) header.insertAdjacentElement("afterend", target);
        else content.prepend(target);
      }
      setMount((current) => current === target ? current : target);
    };

    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      restoreLegacy();
    };
  }, []);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [mount, load]);

  useEffect(() => {
    const refresh = () => { if (mount) void load(); };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("civ:inventory-changed", refresh);
    window.addEventListener("civ:inventory-updated", refresh);
    window.addEventListener("civ:field-orders-changed", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("civ:inventory-changed", refresh);
      window.removeEventListener("civ:inventory-updated", refresh);
      window.removeEventListener("civ:field-orders-changed", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [load, mount]);

  const saleGroups = useMemo(() => groupSales(data?.rows ?? []), [data]);
  const activeSales = useMemo(() => saleGroups.filter((group) => group.activeRows.length > 0), [saleGroups]);
  const canceledSales = useMemo(() => saleGroups.filter((group) => group.voidedRows.length > 0), [saleGroups]);
  const orders = useMemo(() => data?.orders ?? [], [data]);
  const activeOrders = useMemo(() => orders.filter((row) => row.status !== "cancelado" && !row.canceledAt), [orders]);
  const canceledOrders = useMemo(() => orders.filter((row) => row.status === "cancelado" || Boolean(row.canceledAt)).slice().sort((left, right) => (right.canceledAt || right.createdAt).localeCompare(left.canceledAt || left.createdAt)), [orders]);
  const purchases = useMemo(() => (data?.rows ?? []).filter((row) => ["inventario_inicial", "entrada_compra"].includes(row.type)), [data]);
  const returns = useMemo(() => (data?.rows ?? []).filter((row) => ["devolucion_cliente", "devolucion_proveedor"].includes(row.type)), [data]);
  const adjustments = useMemo(() => (data?.rows ?? []).filter((row) => ["defectuoso", "ajuste_positivo", "ajuste_negativo"].includes(row.type)), [data]);

  async function voidMovement(row: Movement) {
    if (!data?.canDelete || row.voided) return;
    const reason = window.prompt(row.type === "venta" ? "Motivo obligatorio para anular este producto de la venta" : "Motivo obligatorio de anulación");
    if (!reason?.trim()) return;
    setError("");
    setNotice("");
    try {
      const response = row.type === "venta"
        ? await fetch("/api/sales/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ movementId: row.id, reason: reason.trim() }) })
        : await fetch("/api/data", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "void_movement", id: row.id, reason: reason.trim() }) });
      const json = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo anular el movimiento.");
      setNotice(json.message || "Movimiento anulado correctamente.");
      window.dispatchEvent(new CustomEvent("civ:inventory-changed"));
      await load();
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo anular el movimiento.");
    }
  }

  if (!mount) return null;

  const title = category === "ventas" ? "Ventas realizadas"
    : category === "ventas-anuladas" ? "Ventas anuladas"
      : category === "pedidos" ? "Pedidos realizados"
        : category === "pedidos-anulados" ? "Pedidos anulados"
          : category === "compras" ? "Compras y entradas"
            : category === "devoluciones" ? "Devoluciones"
              : category === "ajustes" ? "Ajustes e incidencias" : "Movimientos clasificados";

  return createPortal(<section style={{ marginBottom: 18 }}>
    {error && <div className="alert error">{error}<button type="button" onClick={() => setError("")}>×</button></div>}
    {notice && <div className="alert success">{notice}<button type="button" onClick={() => setNotice("")}>×</button></div>}

    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
      <div><strong style={{ display: "block", fontSize: 20 }}>{title}</strong><small style={{ color: "var(--muted)" }}>{category ? "Consulta únicamente esta clase de movimientos." : "Elige una categoría para evitar mezclar operaciones distintas."}</small></div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button type="button" className="mini" onClick={() => void load()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</button>
        {category && <button type="button" className="secondary" onClick={() => setCategory(null)}>← Categorías</button>}
      </div>
    </div>

    {loading && !data ? <div className="loading">Clasificando movimientos…</div> : !category ? <div style={{ display: "grid", gap: 10 }}>
      <CategoryButton title="Ventas realizadas" note="Ventas vigentes agrupadas por folio y cliente." count={activeSales.length} onClick={() => setCategory("ventas")} />
      <CategoryButton title="Ventas anuladas" note="Anulaciones completas o parciales, con desglose por producto." count={canceledSales.length} onClick={() => setCategory("ventas-anuladas")} />
      <CategoryButton title="Pedidos realizados" note="Solo pedidos vigentes o completados. Al anular uno desaparece de aquí." count={data?.orderSummary?.active ?? activeOrders.length} onClick={() => setCategory("pedidos")} />
      <CategoryButton title="Pedidos anulados" note="Cada cancelación conserva fecha, usuario y motivo; el conteo aumenta por pedido anulado." count={data?.orderSummary?.canceled ?? canceledOrders.length} onClick={() => setCategory("pedidos-anulados")} />
      <CategoryButton title="Compras y entradas" note="Inventario inicial y entradas de mercancía." count={purchases.length} onClick={() => setCategory("compras")} />
      <CategoryButton title="Devoluciones" note="De cliente y a proveedor, separadas de las ventas." count={returns.length} onClick={() => setCategory("devoluciones")} />
      <CategoryButton title="Ajustes e incidencias" note="Ajustes positivos/negativos y producto defectuoso." count={adjustments.length} onClick={() => setCategory("ajustes")} />
    </div> : <div>
      {category === "ventas" && <SaleCards groups={activeSales} canceled={false} canDelete={Boolean(data?.canDelete)} canAudit={Boolean(data?.canAudit)} onVoid={(row) => void voidMovement(row)} onAudit={setAuditMovement} />}
      {category === "ventas-anuladas" && <SaleCards groups={canceledSales} canceled canDelete={Boolean(data?.canDelete)} canAudit={Boolean(data?.canAudit)} onVoid={(row) => void voidMovement(row)} onAudit={setAuditMovement} />}
      {category === "pedidos" && <OrderList rows={activeOrders} canceled={false} />}
      {category === "pedidos-anulados" && <OrderList rows={canceledOrders} canceled />}
      {category === "compras" && <MovementList rows={purchases} canDelete={Boolean(data?.canDelete)} canAudit={Boolean(data?.canAudit)} onVoid={(row) => void voidMovement(row)} onAudit={setAuditMovement} />}
      {category === "devoluciones" && <MovementList rows={returns} canDelete={Boolean(data?.canDelete)} canAudit={Boolean(data?.canAudit)} onVoid={(row) => void voidMovement(row)} onAudit={setAuditMovement} />}
      {category === "ajustes" && <MovementList rows={adjustments} canDelete={Boolean(data?.canDelete)} canAudit={Boolean(data?.canAudit)} onVoid={(row) => void voidMovement(row)} onAudit={setAuditMovement} />}
    </div>}

    {auditMovement && <MovementAuditDialog movementId={auditMovement} close={() => setAuditMovement(null)} />}
  </section>, mount);
}
