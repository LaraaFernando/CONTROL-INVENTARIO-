"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Product = { id: number; sku: string; name: string; category: string; unit: string; salePrice: number; currentStock: number };
type Client = { id: number; name: string; businessName: string; phone: string; address: string };
type Order = { id: number; folio: string; status: string; totalAmount: number; createdBy: string; businessDate: string; createdAt: string; clientName: string; lineCount: number };
type Context = { products: Product[]; clients: Client[]; orders: Order[]; canCreateOrder: boolean; canCreateClient: boolean };
type Line = { productId: number; quantity: number };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function normalize(value: string) {
  return value.trim().toLocaleLowerCase("es-MX").replace(/^#/, "");
}

export default function FieldOrderExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [context, setContext] = useState<Context | null>(null);
  const [open, setOpen] = useState(false);
  const [clientOpen, setClientOpen] = useState(false);
  const [clientId, setClientId] = useState(0);
  const [search, setSearch] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/field-orders", { cache: "no-store" });
      const json = await response.json() as Context & { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar los pedidos.");
      setContext(json);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar los pedidos.");
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const heading = document.querySelector<HTMLElement>(".content h1");
      const content = document.querySelector<HTMLElement>(".content");
      if (!content || heading?.textContent?.trim() !== "Ventas") {
        setMount((current) => current ? null : current);
        return;
      }
      let target = content.querySelector<HTMLElement>("[data-civ-field-order-mount]");
      if (!target) {
        target = document.createElement("div");
        target.dataset.civFieldOrderMount = "1";
        const header = content.querySelector(":scope > header");
        if (header) header.insertAdjacentElement("afterend", target);
        else content.prepend(target);
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

  const results = useMemo(() => {
    const query = normalize(search);
    if (!query || !context) return [];
    return context.products.filter((product) =>
      normalize(product.sku).includes(query)
      || normalize(product.name).includes(query)
      || normalize(product.category || "").includes(query),
    ).slice(0, 10);
  }, [context, search]);

  const total = useMemo(() => {
    if (!context) return 0;
    return lines.reduce((sum, line) => {
      const product = context.products.find((row) => row.id === line.productId);
      return sum + Number(product?.salePrice || 0) * line.quantity;
    }, 0);
  }, [context, lines]);

  function add(product: Product) {
    setLines((current) => {
      const existing = current.find((line) => line.productId === product.id);
      if (existing) return current.map((line) => line.productId === product.id ? { ...line, quantity: Math.min(product.currentStock, line.quantity + 1) } : line);
      return [...current, { productId: product.id, quantity: 1 }];
    });
    setSearch("");
  }

  function startOrder() {
    setError("");
    setNotice("");
    setClientId(0);
    setLines([]);
    setSearch("");
    setNotes("");
    setOpen(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!clientId) { setError("Selecciona un cliente antes de enviar el pedido."); return; }
    if (!lines.length) { setError("Agrega al menos un producto al pedido."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/field-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create_order", clientId, notes, items: lines }),
      });
      const json = await response.json() as { folio?: string; totalAmount?: number; error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo enviar el pedido.");
      setOpen(false);
      setNotice(`Pedido ${json.folio} enviado al almacén por ${money.format(Number(json.totalAmount || 0))}.`);
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo enviar el pedido.");
    } finally { setBusy(false); }
  }

  async function createClient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/field-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create_client",
          name: form.get("name"), businessName: form.get("businessName"),
          phone: form.get("phone"), address: form.get("address"),
        }),
      });
      const json = await response.json() as { client?: Client; error?: string };
      if (!response.ok || !json.client) throw new Error(json.error || "No se pudo registrar el cliente.");
      await load();
      setClientId(json.client.id);
      setClientOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo registrar el cliente.");
    } finally { setBusy(false); }
  }

  if (!mount) return null;

  return createPortal(<>
    <section style={{ margin: "0 0 18px", padding: 16, border: "1px solid var(--line)", borderRadius: 18, background: "var(--card)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
        <div><strong style={{ display: "block", fontSize: 19 }}>Pedidos de campo</strong><small style={{ color: "var(--muted)" }}>Levanta el pedido aquí. El almacén lo recibe sin descontar todavía el inventario.</small></div>
        {context?.canCreateOrder && <button type="button" className="primary" onClick={startOrder}>＋ Levantar pedido</button>}
      </div>
      {notice && <div className="alert success" style={{ marginTop: 12 }}>{notice}</div>}
      {context?.orders?.length ? <div style={{ display: "grid", gap: 8, marginTop: 14 }}>
        {context.orders.slice(0, 4).map((order) => <div key={order.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: 12, borderRadius: 12, background: "var(--soft)" }}>
          <span><code style={{ fontWeight: 800 }}>{order.folio}</code><strong style={{ display: "block" }}>{order.clientName}</strong><small style={{ color: "var(--muted)" }}>{order.lineCount} partida{Number(order.lineCount) === 1 ? "" : "s"} · {order.createdBy}</small></span>
          <span style={{ textAlign: "right" }}><b>{money.format(Number(order.totalAmount || 0))}</b><small style={{ display: "block", color: "var(--muted)" }}>Pedido levantado</small></span>
        </div>)}
      </div> : null}
    </section>

    {open && context && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setOpen(false); }}>
      <div className="modal operations-modal">
        <div className="modal-head"><div><p>PEDIDO DE CAMPO</p><h2>Levantar pedido</h2></div><button type="button" onClick={() => setOpen(false)} disabled={busy}>×</button></div>
        <form onSubmit={submit}>
          {error && <div className="alert error">{error}</div>}
          <div className="form-grid">
            <label className="wide"><span>Cliente *</span><div style={{ display: "flex", gap: 8 }}><select style={{ flex: 1 }} value={clientId || ""} onChange={(event) => setClientId(Number(event.target.value))} required><option value="">Selecciona cliente</option>{context.clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.businessName ? ` · ${client.businessName}` : ""}</option>)}</select>{context.canCreateClient && <button type="button" className="mini" onClick={() => setClientOpen(true)}>＋ Cliente</button>}</div></label>
            <label className="wide"><span>Notas del pedido</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Indicaciones para almacén o entrega" /></label>
          </div>

          <div className="card" style={{ padding: 14, marginTop: 16 }}>
            <strong>Agregar productos</strong>
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Código, nombre o categoría" style={{ width: "100%", marginTop: 9 }} />
            {search.trim() && <div style={{ display: "grid", gap: 7, marginTop: 9 }}>{results.map((product) => <button key={product.id} type="button" disabled={product.currentStock <= 0} onClick={() => add(product)} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: 10, textAlign: "left", border: "1px solid var(--line)", borderRadius: 10, background: "var(--card)", color: "var(--text)" }}><span><code>{product.sku}</code><strong style={{ display: "block" }}>{product.name}</strong><small style={{ color: "var(--muted)" }}>{product.currentStock} disponibles</small></span><b>{money.format(product.salePrice)}</b></button>)}</div>}
          </div>

          <div style={{ display: "grid", gap: 9, marginTop: 16 }}>{lines.map((line) => {
            const product = context.products.find((row) => row.id === line.productId);
            if (!product) return null;
            return <div key={line.productId} style={{ display: "grid", gridTemplateColumns: "1fr 110px 36px", gap: 8, alignItems: "center", padding: 11, border: "1px solid var(--line)", borderRadius: 12 }}><span><code>{product.sku}</code><strong style={{ display: "block" }}>{product.name}</strong><small style={{ color: "var(--muted)" }}>{money.format(product.salePrice)} c/u · {product.currentStock} disponibles</small></span><input type="number" min={1} max={product.currentStock} value={line.quantity} onChange={(event) => setLines((current) => current.map((row) => row.productId === line.productId ? { ...row, quantity: Math.max(1, Math.min(product.currentStock, Number(event.target.value) || 1)) } : row))} /><button type="button" className="mini danger" onClick={() => setLines((current) => current.filter((row) => row.productId !== line.productId))}>×</button></div>;
          })}</div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18, fontSize: 18 }}><strong>Total</strong><strong>{money.format(total)}</strong></div>
          <div className="modal-actions"><button type="button" className="secondary" onClick={() => setOpen(false)} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || !lines.length}>{busy ? "Enviando…" : "Enviar pedido al almacén"}</button></div>
        </form>
      </div>
    </div>}

    {clientOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setClientOpen(false); }}><div className="modal"><div className="modal-head"><div><p>CLIENTE NUEVO</p><h2>Registrar cliente</h2></div><button type="button" onClick={() => setClientOpen(false)}>×</button></div><form onSubmit={createClient}><div className="form-grid"><label><span>Nombre *</span><input name="name" required /></label><label><span>Nombre del negocio</span><input name="businessName" /></label><label><span>Teléfono</span><input name="phone" inputMode="tel" /></label><label className="wide"><span>Dirección</span><input name="address" /></label></div><div className="modal-actions"><button type="button" className="secondary" onClick={() => setClientOpen(false)}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar y usar"}</button></div></form></div></div>}
  </>, mount);
}
