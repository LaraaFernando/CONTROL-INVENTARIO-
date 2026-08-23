"use client";

import { FormEvent, useMemo, useState } from "react";

type Product = {
  id: number;
  sku: string;
  name: string;
  salePrice: number;
  currentStock: number;
  setFactor: number;
  boxFactor: number;
};

type Client = { id: number; name: string };
type SaleLine = { key: number; productId: string; presentation: string; quantity: string };
type SaleResult = {
  ok: boolean;
  reference: string;
  lineCount: number;
  totalAmount: number;
  warning?: string;
};

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function factorFor(product: Product | undefined, presentation: string) {
  if (presentation === "ciento") return 100;
  if (presentation === "juego") return Math.max(1, Number(product?.setFactor || 1));
  if (presentation === "caja") return Math.max(1, Number(product?.boxFactor || 1));
  return 1;
}

export function SaleModal({ products, clients, close, onSaved, onUnauthorized }: {
  products: Product[];
  clients: Client[];
  close: () => void;
  onSaved: (message: string) => Promise<void> | void;
  onUnauthorized: () => void;
}) {
  const [lines, setLines] = useState<SaleLine[]>([
    { key: 1, productId: String(products[0]?.id ?? ""), presentation: "pieza", quantity: "1" },
  ]);
  const [nextKey, setNextKey] = useState(2);
  const [clientId, setClientId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const previews = useMemo(() => {
    const remaining = new Map(products.map(product => [product.id, product.currentStock]));
    return lines.map(line => {
      const product = products.find(row => String(row.id) === line.productId);
      const factor = factorFor(product, line.presentation);
      const presentations = Math.max(0, Math.floor(Number(line.quantity) || 0));
      const requested = presentations * factor;
      const available = product ? remaining.get(product.id) ?? product.currentStock : 0;
      const fulfilled = Math.min(requested, available);
      const pending = Math.max(0, requested - fulfilled);
      if (product) remaining.set(product.id, Math.max(0, available - fulfilled));
      return {
        product,
        factor,
        requested,
        fulfilled,
        pending,
        subtotal: fulfilled * Number(product?.salePrice || 0),
      };
    });
  }, [lines, products]);

  const total = previews.reduce((sum, row) => sum + row.subtotal, 0);
  const totalPending = previews.reduce((sum, row) => sum + row.pending, 0);

  function addLine() {
    setLines(current => [...current, {
      key: nextKey,
      productId: String(products[0]?.id ?? ""),
      presentation: "pieza",
      quantity: "1",
    }]);
    setNextKey(value => value + 1);
  }

  function updateLine(key: number, patch: Partial<SaleLine>) {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  }

  function removeLine(key: number) {
    setLines(current => current.length > 1 ? current.filter(line => line.key !== key) : current);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!lines.length || lines.some(line => !line.productId || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1)) {
      setError("Selecciona un producto y una cantidad válida en cada partida.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientId: clientId || null,
          reference,
          notes,
          items: lines.map(line => ({
            productId: Number(line.productId),
            presentation: line.presentation,
            quantity: Number(line.quantity),
          })),
        }),
      });
      const json = await response.json() as SaleResult & { error?: string };
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(json.error || "No se pudo registrar la venta.");
      const message = json.warning || `Venta ${json.reference} registrada con ${json.lineCount} partida(s) por ${money.format(json.totalAmount)}.`;
      await onSaved(message);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo registrar la venta.");
    } finally {
      setBusy(false);
    }
  }

  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) close(); }}>
    <div className="modal operations-modal">
      <div className="modal-head"><div><p>NUEVA VENTA</p><h2>Venta con múltiples productos</h2></div><button onClick={close} disabled={busy} aria-label="Cerrar">×</button></div>
      <form onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <div className="form-grid">
          <label><span>Cliente relacionado</span><select value={clientId} onChange={event => setClientId(event.target.value)}><option value="">Sin seleccionar</option>{clients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
          <label><span>Folio o referencia</span><input value={reference} onChange={event => setReference(event.target.value)} placeholder="Se genera automáticamente si lo dejas vacío" /></label>
          <label className="wide"><span>Observaciones</span><input value={notes} onChange={event => setNotes(event.target.value)} /></label>
        </div>

        <div className="line-editor" style={{ marginTop: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
            <div><h3 style={{ margin: 0 }}>Productos de la venta</h3><small style={{ color: "var(--muted)" }}>Agrega todas las partidas que necesites; CIV no impone un límite de productos.</small></div>
            <button type="button" className="secondary" onClick={addLine}>＋ Agregar producto</button>
          </div>
          {lines.map((line, index) => {
            const preview = previews[index];
            const product = preview?.product;
            return <div key={line.key} className="card" style={{ padding: 14, marginBottom: 12, overflow: "visible" }}>
              <div className="form-grid">
                <label><span>Producto *</span><select value={line.productId} onChange={event => updateLine(line.key, { productId: event.target.value })} required>{products.map(row => <option key={row.id} value={row.id}>{row.sku} · {row.name} · stock {row.currentStock}</option>)}</select></label>
                <label><span>Presentación *</span><select value={line.presentation} onChange={event => updateLine(line.key, { presentation: event.target.value })}><option value="pieza">Pieza · factor 1</option><option value="unidad">Unidad · factor 1</option><option value="ciento">Ciento · factor 100</option><option value="juego">Juego · factor {product?.setFactor || 1}</option><option value="caja">Caja · factor {product?.boxFactor || 1}</option></select></label>
                <label><span>Cantidad de presentaciones *</span><input inputMode="numeric" type="number" min="1" step="1" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} required /></label>
                <label><span>Precio unitario base</span><input value={money.format(Number(product?.salePrice || 0))} readOnly /></label>
              </div>
              <div className="field-note" style={{ marginTop: 10 }}>
                Solicita <b>{preview?.requested || 0}</b> unidad(es) base · Se surtirán <b>{preview?.fulfilled || 0}</b> · Subtotal <b>{money.format(preview?.subtotal || 0)}</b>{preview?.pending ? <span className="danger-text"> · Faltan {preview.pending}</span> : null}
              </div>
              {lines.length > 1 && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}><button type="button" className="mini danger" onClick={() => removeLine(line.key)}>Quitar producto</button></div>}
            </div>;
          })}
        </div>

        <div className="card" style={{ padding: 16, marginTop: 18 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><span><strong>Total de la venta</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>{lines.length} partida(s){totalPending > 0 ? ` · ${totalPending} unidad(es) pendientes por falta de stock` : " · stock suficiente"}</small></span><strong style={{ fontSize: 24 }}>{money.format(total)}</strong></div>
        </div>

        <div className="modal-actions"><button type="button" className="ghost" onClick={close} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || !products.length}>{busy ? "Registrando venta…" : "Confirmar venta"}</button></div>
      </form>
    </div>
  </div>;
}
