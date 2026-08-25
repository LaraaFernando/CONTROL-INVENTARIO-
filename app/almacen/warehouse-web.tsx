"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./warehouse-web.module.css";

type Status = "levantado" | "preparando" | "transito" | "entregado" | "cancelado";
type Item = {
  id: number;
  productId: number;
  quantity: number;
  unitAmount: number;
  totalAmount: number;
  sku: string;
  productName: string;
  unit: string;
  currentStock: number;
};
type Order = {
  id: number;
  folio: string;
  clientName: string;
  status: Status;
  totalAmount: number;
  notes: string;
  createdBy: string;
  businessDate: string;
  createdAt: string;
  saleReference: string;
  items: Item[];
};
type WarehouseData = {
  orders: Order[];
  canManageWarehouse: boolean;
  summary: { newOrders: number; preparing: number; inTransit: number; delivered: number };
  error?: string;
};
type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
};
type FieldData = { products: Product[]; error?: string };
type AuthData = {
  authenticated?: boolean;
  user?: {
    displayName: string;
    role: string;
    permissions: Record<string, boolean>;
  };
};

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const statusLabel: Record<Status, string> = {
  levantado: "Nuevo pedido",
  preparando: "Preparando",
  transito: "En tránsito",
  entregado: "Entregado",
  cancelado: "Cancelado",
};

export default function WarehouseWeb() {
  const [auth, setAuth] = useState<AuthData | null>(null);
  const [warehouse, setWarehouse] = useState<WarehouseData | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(0);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"activos" | Status | "todos">("activos");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<number | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const authResponse = await fetch("/api/auth", { cache: "no-store" });
      const authJson = await authResponse.json() as AuthData;
      if (!authResponse.ok || !authJson.authenticated) {
        setAuth(authJson);
        setWarehouse(null);
        return;
      }
      setAuth(authJson);

      const [warehouseResponse, fieldResponse] = await Promise.all([
        fetch("/api/field-order-warehouse", { cache: "no-store" }),
        fetch("/api/field-orders", { cache: "no-store" }),
      ]);
      const warehouseJson = await warehouseResponse.json() as WarehouseData;
      const fieldJson = await fieldResponse.json() as FieldData;
      if (!warehouseResponse.ok) throw new Error(warehouseJson.error || "No se pudieron cargar los pedidos.");
      if (!fieldResponse.ok) throw new Error(fieldJson.error || "No se pudo cargar el inventario.");
      setWarehouse(warehouseJson);
      setProducts(fieldJson.products ?? []);
      setError("");
      setLastUpdated(new Date());
      if (!selected && warehouseJson.orders.length) {
        const firstActive = warehouseJson.orders.find((order) => !["entregado", "cancelado"].includes(order.status));
        setSelected(firstActive?.id ?? warehouseJson.orders[0]?.id ?? null);
      }
      document.title = warehouseJson.summary.newOrders > 0
        ? `(${warehouseJson.summary.newOrders}) CIV Almacén`
        : "CIV Almacén";
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar CIV Almacén.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [selected]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const interval = window.setInterval(() => { void load(true); }, 12000);
    return () => window.clearInterval(interval);
  }, [load]);

  const visibleOrders = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("es-MX");
    return (warehouse?.orders ?? []).filter((order) => {
      const matchesFilter = filter === "todos"
        || (filter === "activos" && !["entregado", "cancelado"].includes(order.status))
        || order.status === filter;
      if (!matchesFilter) return false;
      if (!query) return true;
      return `${order.folio} ${order.clientName} ${order.createdBy} ${order.saleReference}`
        .toLocaleLowerCase("es-MX").includes(query);
    });
  }, [warehouse, filter, search]);

  const selectedOrder = useMemo(
    () => warehouse?.orders.find((order) => order.id === selected) ?? visibleOrders[0] ?? null,
    [warehouse, selected, visibleOrders],
  );

  const stockSummary = useMemo(() => ({
    physical: products.reduce((sum, product) => sum + Number(product.currentStock || 0), 0),
    reserved: products.reduce((sum, product) => sum + Number(product.reservedStock || 0), 0),
    available: products.reduce((sum, product) => sum + Number(product.availableStock || 0), 0),
    lowAvailable: products.filter((product) => product.availableStock <= 0).length,
  }), [products]);

  const act = useCallback(async (order: Order, action: "start_preparing" | "dispatch" | "deliver" | "cancel") => {
    let reason = "";
    let completeConfirmed = false;
    if (action === "cancel") {
      reason = window.prompt(`Motivo para cancelar ${order.folio}`) || "";
      if (!reason.trim()) return;
    }
    if (action === "dispatch") {
      if (!window.confirm(`¿Confirmas que ${order.folio} está completo y saldrá del almacén? Al confirmar se descontará el inventario físico.`)) return;
    }
    if (action === "deliver") {
      completeConfirmed = window.confirm(`¿Confirmas que ${order.clientName} recibió completa la mercancía de ${order.folio}?`);
      if (!completeConfirmed) return;
    }

    setBusy(order.id);
    setError("");
    try {
      const response = await fetch("/api/field-order-warehouse", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orderId: order.id, action, reason, completeConfirmed }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo actualizar el pedido.");
      await load(true);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo actualizar el pedido.");
    } finally {
      setBusy(0);
    }
  }, [load]);

  if (loading && !auth) {
    return <main className={styles.loading}><div className={styles.logo}>CIV</div><strong>Abriendo almacén…</strong></main>;
  }

  if (!auth?.authenticated) {
    return <main className={styles.authPage}>
      <section className={styles.authCard}>
        <div className={styles.logo}>CIV</div>
        <h1>CIV Almacén</h1>
        <p>Inicia sesión en CIV para abrir el tablero de almacén.</p>
        <a href="/" className={styles.primaryLink}>Ir a iniciar sesión</a>
      </section>
    </main>;
  }

  if (!warehouse?.canManageWarehouse) {
    return <main className={styles.authPage}>
      <section className={styles.authCard}>
        <div className={styles.logo}>CIV</div>
        <h1>Acceso de almacén</h1>
        <p>Tu usuario no tiene permiso para administrar pedidos del almacén.</p>
        <a href="/" className={styles.primaryLink}>Volver a CIV</a>
      </section>
    </main>;
  }

  return <main className={styles.shell}>
    <aside className={styles.sidebar}>
      <div className={styles.brand}><div className={styles.logo}>CIV</div><div><strong>CIV Almacén</strong><small>Pedidos e inventario</small></div></div>
      <nav>
        <button className={styles.active}><span>▣</span>Pedidos</button>
        <a href="/#inventario"><span>▦</span>Inventario completo</a>
        <a href="/"><span>⌂</span>Abrir CIV</a>
      </nav>
      <div className={styles.user}><strong>{auth.user?.displayName}</strong><small>Actualización automática cada 12 s</small></div>
    </aside>

    <section className={styles.content}>
      <header className={styles.header}>
        <div><p>OPERACIÓN DE ALMACÉN</p><h1>Pedidos por atender</h1><span>Lo que el vendedor envía desde su celular aparece aquí.</span></div>
        <div className={styles.headerActions}><small>{lastUpdated ? `Actualizado ${lastUpdated.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}` : ""}</small><button onClick={() => void load()} disabled={loading}>{loading ? "Actualizando…" : "Actualizar"}</button></div>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.stats}>
        <button onClick={() => setFilter("levantado")}><b className={styles.orange}>{warehouse.summary.newOrders}</b><span>Nuevos</span><small>Esperando almacén</small></button>
        <button onClick={() => setFilter("preparando")}><b className={styles.yellow}>{warehouse.summary.preparing}</b><span>Preparando</span><small>En surtido</small></button>
        <button onClick={() => setFilter("transito")}><b className={styles.blue}>{warehouse.summary.inTransit}</b><span>En tránsito</span><small>Ya salió</small></button>
        <button onClick={() => setFilter("entregado")}><b className={styles.green}>{warehouse.summary.delivered}</b><span>Entregados</span><small>Completados</small></button>
      </section>

      <section className={styles.stockBar}>
        <div><strong>{stockSummary.physical}</strong><span>Físico</span></div>
        <div><strong>{stockSummary.reserved}</strong><span>Apartado</span></div>
        <div><strong>{stockSummary.available}</strong><span>Disponible</span></div>
        <div><strong>{stockSummary.lowAvailable}</strong><span>Sin disponible</span></div>
      </section>

      <section className={styles.workspace}>
        <div className={styles.listPane}>
          <div className={styles.toolbar}>
            <input type="search" placeholder="Buscar folio, cliente o vendedor" value={search} onChange={(event) => setSearch(event.target.value)} />
            <select value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="activos">Pendientes</option>
              <option value="levantado">Nuevos</option>
              <option value="preparando">Preparando</option>
              <option value="transito">En tránsito</option>
              <option value="entregado">Entregados</option>
              <option value="cancelado">Cancelados</option>
              <option value="todos">Todos</option>
            </select>
          </div>
          <div className={styles.orderList}>
            {visibleOrders.map((order) => <button key={order.id} className={`${styles.orderRow} ${selectedOrder?.id === order.id ? styles.selected : ""}`} onClick={() => setSelected(order.id)}>
              <div><code>{order.folio}</code><strong>{order.clientName}</strong><small>{order.createdBy} · {order.items.length} producto{order.items.length === 1 ? "" : "s"}</small></div>
              <div><span className={`${styles.badge} ${styles[order.status]}`}>{statusLabel[order.status]}</span><b>{money.format(order.totalAmount)}</b></div>
            </button>)}
            {!visibleOrders.length && <div className={styles.empty}>No hay pedidos en esta vista.</div>}
          </div>
        </div>

        <div className={styles.detailPane}>
          {selectedOrder ? <>
            <div className={styles.detailHead}><div><code>{selectedOrder.folio}</code><h2>{selectedOrder.clientName}</h2><p>Vendedor: {selectedOrder.createdBy}</p></div><span className={`${styles.bigBadge} ${styles[selectedOrder.status]}`}>{statusLabel[selectedOrder.status]}</span></div>
            <div className={styles.items}>
              {selectedOrder.items.map((item) => <div key={item.id}><span><code>{item.sku}</code><strong>{item.productName}</strong><small>{item.currentStock} físicos actualmente</small></span><span><b>{item.quantity} {item.unit}</b><small>{money.format(item.totalAmount)}</small></span></div>)}
            </div>
            {selectedOrder.notes && <div className={styles.notes}><strong>Indicaciones</strong><p>{selectedOrder.notes}</p></div>}
            <div className={styles.total}><span>Total del pedido</span><strong>{money.format(selectedOrder.totalAmount)}</strong></div>
            {selectedOrder.saleReference && <div className={styles.saleRef}>Venta generada: <strong>{selectedOrder.saleReference}</strong></div>}
            <div className={styles.actions}>
              {selectedOrder.status === "levantado" && <button className={styles.primary} disabled={busy === selectedOrder.id} onClick={() => void act(selectedOrder, "start_preparing")}>{busy === selectedOrder.id ? "Guardando…" : "Empezar a preparar"}</button>}
              {selectedOrder.status === "preparando" && <button className={styles.primary} disabled={busy === selectedOrder.id} onClick={() => void act(selectedOrder, "dispatch")}>{busy === selectedOrder.id ? "Despachando…" : "Pedido completo · Marcar en tránsito"}</button>}
              {selectedOrder.status === "transito" && <button className={styles.primary} disabled={busy === selectedOrder.id} onClick={() => void act(selectedOrder, "deliver")}>{busy === selectedOrder.id ? "Guardando…" : "Confirmar entrega completa"}</button>}
              {["levantado", "preparando"].includes(selectedOrder.status) && <button className={styles.danger} disabled={busy === selectedOrder.id} onClick={() => void act(selectedOrder, "cancel")}>Cancelar pedido</button>}
            </div>
          </> : <div className={styles.noSelection}>Selecciona un pedido para ver el detalle.</div>}
        </div>
      </section>
    </section>
  </main>;
}
