"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Status = "levantado" | "preparando" | "transito" | "entregado" | "cancelado";
type Item = { id: number; productId: number; quantity: number; unitAmount: number; totalAmount: number; sku: string; productName: string; unit: string; currentStock: number };
type Order = {
  id: number; folio: string; clientName: string; status: Status; totalAmount: number; notes: string;
  createdBy: string; businessDate: string; createdAt: string; saleReference: string; items: Item[];
};
type Data = {
  orders: Order[];
  canManageWarehouse: boolean;
  summary: { newOrders: number; preparing: number; inTransit: number; delivered: number };
  error?: string;
};

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const statusLabel: Record<Status, string> = {
  levantado: "Pedido levantado",
  preparando: "Preparando",
  transito: "En tránsito",
  entregado: "Entregado",
  cancelado: "Cancelado",
};
const statusBackground: Record<Status, string> = {
  levantado: "color-mix(in srgb, #f59e0b 14%, var(--card))",
  preparando: "color-mix(in srgb, #eab308 14%, var(--card))",
  transito: "color-mix(in srgb, #3b82f6 14%, var(--card))",
  entregado: "color-mix(in srgb, #22c55e 14%, var(--card))",
  cancelado: "var(--soft)",
};

export default function FieldOrderWarehouseExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  const [showFinished, setShowFinished] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/field-order-warehouse", { cache: "no-store" });
      const json = await response.json() as Data;
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar los pedidos del almacén.");
      setData(json);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar los pedidos del almacén.");
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const heading = document.querySelector<HTMLElement>(".content h1");
      const content = document.querySelector<HTMLElement>(".content");
      const currentTitle = heading?.textContent?.trim() || "";
      if (!content || !["Ventas", "Pedido", "Pedidos"].includes(currentTitle)) {
        setMount((current) => current ? null : current);
        return;
      }
      let target = content.querySelector<HTMLElement>("[data-civ-warehouse-orders-mount]");
      if (!target) {
        target = document.createElement("div");
        target.dataset.civWarehouseOrdersMount = "1";
        const fieldOrders = content.querySelector("[data-civ-field-order-mount]");
        if (fieldOrders) fieldOrders.insertAdjacentElement("afterend", target);
        else {
          const header = content.querySelector(":scope > header");
          if (header) header.insertAdjacentElement("afterend", target);
          else content.prepend(target);
        }
      }
      setMount((current) => current === target ? current : target);
    };
    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { window.clearTimeout(timer); observer.disconnect(); };
  }, []);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [mount, load]);

  const visible = useMemo(() => {
    const rows = data?.orders ?? [];
    return showFinished ? rows : rows.filter((order) => !["entregado", "cancelado"].includes(order.status));
  }, [data, showFinished]);

  const act = useCallback(async (order: Order, action: "start_preparing" | "dispatch" | "deliver" | "cancel") => {
    let reason = "";
    let completeConfirmed = false;
    if (action === "cancel") {
      reason = window.prompt(`Motivo para cancelar completo ${order.folio}`) || "";
      if (!reason.trim()) return;
    }
    if (action === "dispatch") {
      if (!window.confirm(`¿Confirmas que el pedido ${order.folio} está completo y saldrá del almacén? Al confirmar se descontará el inventario físico.`)) return;
    }
    if (action === "deliver") {
      completeConfirmed = window.confirm(`¿Confirmas que ${order.clientName} recibió completa la mercancía de ${order.folio}?`);
      if (!completeConfirmed) return;
    }

    setBusy(order.id); setError("");
    try {
      const response = await fetch("/api/field-order-warehouse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id, action, reason, completeConfirmed }),
      });
      const json = await response.json() as { error?: string; saleReference?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo actualizar el pedido.");
      await load();
      window.dispatchEvent(new CustomEvent("civ:field-orders-changed"));
      window.dispatchEvent(new CustomEvent("civ:inventory-updated"));
      window.dispatchEvent(new CustomEvent("civ:inventory-changed"));
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo actualizar el pedido.");
    } finally { setBusy(0); }
  }, [load]);

  const adjustItem = useCallback(async (order: Order, item: Item) => {
    if (!["levantado", "preparando"].includes(order.status)) return;
    const value = window.prompt(`Cantidad de ${item.sku} · ${item.productName} a anular (1 a ${item.quantity})`, String(item.quantity));
    if (value == null) return;
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > item.quantity) {
      setError(`La cantidad debe ser un entero entre 1 y ${item.quantity}.`);
      return;
    }
    if (order.items.length === 1 && quantity === item.quantity) {
      if (window.confirm("Es el último producto del pedido. Para conservar correctamente el historial se cancelará el pedido completo. ¿Continuar?")) {
        await act(order, "cancel");
      }
      return;
    }
    const reason = window.prompt("Motivo para anular este producto o cantidad") || "";
    if (!reason.trim()) return;

    setBusy(order.id); setError("");
    try {
      const response = await fetch("/api/field-orders/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel_item", orderId: order.id, itemId: item.id, quantity, reason: reason.trim() }),
      });
      const json = await response.json() as { error?: string; message?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo ajustar el pedido.");
      await load();
      window.dispatchEvent(new CustomEvent("civ:field-orders-changed"));
      window.dispatchEvent(new CustomEvent("civ:inventory-updated"));
      window.dispatchEvent(new CustomEvent("civ:inventory-changed"));
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo ajustar el pedido.");
    } finally { setBusy(0); }
  }, [act, load]);

  if (!mount || !data?.canManageWarehouse) return null;

  return createPortal(
    <section style={{ marginBottom: 18, padding: 16, border: "1px solid var(--line)", borderRadius: 18, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div><strong style={{ display: "block", fontSize: 19 }}>Almacén · pedidos por atender</strong><small style={{ color: "var(--muted)" }}>Puedes ajustar productos mientras el pedido esté Levantado o Preparando. El inventario físico sale hasta marcar En tránsito.</small></div>
        <button type="button" className="mini" onClick={() => void load()}>Actualizar</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
        <div style={{ padding: 10, borderRadius: 12, background: statusBackground.levantado }}><strong style={{ display: "block", fontSize: 20 }}>{data.summary.newOrders}</strong><small>Nuevos</small></div>
        <div style={{ padding: 10, borderRadius: 12, background: statusBackground.preparando }}><strong style={{ display: "block", fontSize: 20 }}>{data.summary.preparing}</strong><small>Preparando</small></div>
        <div style={{ padding: 10, borderRadius: 12, background: statusBackground.transito }}><strong style={{ display: "block", fontSize: 20 }}>{data.summary.inTransit}</strong><small>En tránsito</small></div>
      </div>
      {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {visible.map((order) => <article key={order.id} style={{ padding: 13, border: "1px solid var(--line)", borderRadius: 14, background: statusBackground[order.status] }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
            <span><code style={{ fontWeight: 800 }}>{order.folio}</code><strong style={{ display: "block", marginTop: 3 }}>{order.clientName}</strong><small style={{ color: "var(--muted)" }}>{order.createdBy} · {money.format(order.totalAmount)}</small></span>
            <span style={{ fontWeight: 800 }}>{statusLabel[order.status]}</span>
          </div>
          <div style={{ display: "grid", gap: 7, marginTop: 10 }}>
            {order.items.map((item) => <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, alignItems: "center" }}>
              <span><code>{item.sku}</code> · {item.productName}<strong style={{ display: "block", marginTop: 2 }}>{item.quantity} {item.unit}</strong></span>
              {["levantado", "preparando"].includes(order.status) && <button type="button" className="mini danger" disabled={busy === order.id} onClick={() => void adjustItem(order, item)}>Anular producto</button>}
            </div>)}
          </div>
          {order.notes && <small style={{ display: "block", marginTop: 8, color: "var(--muted)" }}>Nota: {order.notes}</small>}
          {order.saleReference && <small style={{ display: "block", marginTop: 5, color: "var(--muted)" }}>Venta: {order.saleReference}</small>}
          {!["entregado", "cancelado"].includes(order.status) && <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 12 }}>
            {order.status === "levantado" && <button type="button" className="primary" disabled={busy === order.id} onClick={() => void act(order, "start_preparing")}>{busy === order.id ? "Guardando…" : "Empezar a preparar"}</button>}
            {order.status === "preparando" && <button type="button" className="primary" disabled={busy === order.id} onClick={() => void act(order, "dispatch")}>{busy === order.id ? "Despachando…" : "Pedido completo · En tránsito"}</button>}
            {order.status === "transito" && <button type="button" className="primary" disabled={busy === order.id} onClick={() => void act(order, "deliver")}>{busy === order.id ? "Guardando…" : "Confirmar entrega"}</button>}
            {["levantado", "preparando"].includes(order.status) && <button type="button" className="mini danger" disabled={busy === order.id} onClick={() => void act(order, "cancel")}>Cancelar pedido completo</button>}
          </div>}
        </article>)}
        {!visible.length && <div style={{ padding: 14, color: "var(--muted)" }}>No hay pedidos pendientes por atender.</div>}
      </div>
      {(data.summary.delivered > 0 || data.orders.some((order) => order.status === "cancelado")) && <button type="button" className="mini" style={{ marginTop: 10 }} onClick={() => setShowFinished((value) => !value)}>{showFinished ? "Ocultar terminados" : "Ver entregados/cancelados"}</button>}
    </section>,
    mount,
  );
}