"use client";

import { FormEvent, useMemo, useState } from "react";
import { normalizeCommercialUnit, presentationFactor, unitLabel, validBoxFactor } from "./commercial-units";

type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  salePrice: number;
  currentStock: number;
  boxFactor: number;
};

type Client = { id: number; name: string };
type SaleLine = { key: number; productId: string; presentation: string; quantity: string };
type SaleResult = { ok: boolean; reference: string; lineCount: number; totalAmount: number; warning?: string };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function defaultPresentation(product: Product | undefined) {
  return normalizeCommercialUnit(product?.unit || "pieza");
}

export function SaleModal({ products, clients, close, onSaved, onUnauthorized }: {
  products: Product[];
  clients: Client[];
  close: () => void;
  onSaved: (message: string) => Promise<void> | void;
  onUnauthorized: () => void;
}) {
  const first = products[0];
  const [lines, setLines] = useState<SaleLine[]>([
    { key: 1, productId: String(first?.id ?? ""), presentation: defaultPresentation(first), quantity: "1" },
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
      const factor = product ? presentationFactor(product, line.presentation) ?? 1 : 1;
      const presentations = Math.max(0, Math.floor(Number(line.quantity) || 0));
      const requested = presentations * factor;
      const available = product ? remaining.get(product.id) ?? product.currentStock : 0;
      const fulfilled = Math.min(requested, available);
      const pending = Math.max(0, requested - fulfilled);
      if (product) remaining.set(product.id, Math.max(0, available - fulfilled));
      return { product, factor, requested, fulfilled, pending, subtotal: fulfilled * Number(product?.salePrice || 0) };
    });
  }, [lines, products]);

  const total = previews.reduce((sum, row) => sum + row.subtotal, 0);

  function addLine() {
    const product = products[0];
    setLines(current => [...current, { key: nextKey, productId: String(product?.id ?? ""), presentation: defaultPresentation(product), quantity: "1" }]);
    setNextKey(value => value + 1);
  }

  function updateProduct(key: number, productId: string) {
    const product = products.find(row => String(row.id) === productId);
    setLines(current => current.map(line => line.key === key ? { ...line, productId, presentation: defaultPresentation(product) } : line));
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
        body: JSON.stringify({ clientId: clientId || null, reference, notes, items: lines.map(line => ({ productId: Number(line.productId), presentation: line.presentation, quantity: Number(line.quantity) })) }),
      });
      const json = await response.json() as SaleResult & { error?: string };
      if (response.status === 401) { onUnauthorized(); return; }
      if (!response.ok) throw new Error(json.error || "No se pudo registrar la venta.");
      await onSaved(json.warning || `Venta ${json.reference} registrada con ${json.lineCount} partida(s) por ${money.format(json.totalAmount)}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo registrar la venta.");
    } finally { setBusy(false); }
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
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}><div><h3 style={{ margin: 0 }}>Productos de la venta</h3><small style={{ color: "var(--muted)" }}>Cada producto muestra únicamente su unidad real de venta y, si aplica, la caja.</small></div><button type="button" className="secondary" onClick={addLine}>＋ Agregar producto</button></div>
          {lines.map((line, index) => {
            const preview = previews[index];
            const product = preview?.product;
            const baseUnit = defaultPresentation(product);
            const box = validBoxFactor(product?.boxFactor);
            const baseName = unitLabel(baseUnit);
            return <div key={line.key} className="card" style={{ padding: 14, marginBottom: 12, overflow: "visible" }}>
              <div className="form-grid">
                <label><span>Producto *</span><select value={line.productId} onChange={event => updateProduct(line.key, event.target.value)} required>{products.map(row => <option key={row.id} value={row.id}>{row.sku} · {row.name} · {row.currentStock} {unitLabel(row.unit, row.currentStock !== 1)}</option>)}</select></label>
                <label><span>Forma de venta *</span><select value={line.presentation} onChange={event => updateLine(line.key, { presentation: event.target.value })}><option value={baseUnit}>{baseName.charAt(0).toUpperCase() + baseName.slice(1)} · 1 = 1</option>{box ? <option value="caja">Caja · {box} {unitLabel(baseUnit, box !== 1)}</option> : null}</select></label>
                <label><span>Cantidad *</span><input inputMode="numeric" type="number" min="1" step="1" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} required /></label>
                <label><span>Precio por {baseName}</span><input value={money.format(Number(product?.salePrice || 0))} readOnly /></label>
              </div>
              <div className="field-note" style={{ marginTop: 10 }}>Se descontarán <b>{preview?.requested || 0} {unitLabel(baseUnit, (preview?.requested || 0) !== 1)}</b> del inventario · Se surtirán <b>{preview?.fulfilled || 0}</b> · Subtotal <b>{money.format(preview?.subtotal || 0)}</b>{preview?.pending ? <span className="danger-text"> · Faltan {preview.pending} {unitLabel(baseUnit, preview.pending !== 1)}</span> : null}</div>
              {product?.unit === "juego" && <div className="field-note" style={{ marginTop: 8 }}>El contenido interno del juego no multiplica el precio: 5 juegos a {money.format(Number(product.salePrice || 0))} = {money.format(5 * Number(product.salePrice || 0))}.</div>}
              {lines.length > 1 && <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}><button type="button" className="mini danger" onClick={() => removeLine(line.key)}>Quitar producto</button></div>}
            </div>;
          })}
        </div>
        <div className="card" style={{ padding: 16, marginTop: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><span><strong>Total de la venta</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>{lines.length} partida(s)</small></span><strong style={{ fontSize: 24 }}>{money.format(total)}</strong></div></div>
        <div className="modal-actions"><button type="button" className="ghost" onClick={close} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || !products.length}>{busy ? "Registrando venta…" : "Confirmar venta"}</button></div>
      </form>
    </div>
  </div>;
}
