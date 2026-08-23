"use client";

import { FormEvent, useMemo, useState } from "react";
import { normalizeCommercialUnit, presentationFactor, unitLabel, validBoxFactor } from "./commercial-units";

type Product = {
  id: number;
  sku: string;
  name: string;
  category: string;
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

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es-MX");
}

function codeNormalized(value: string) {
  return normalized(value).replace(/^#/, "");
}

function matches(product: Product, query: string) {
  const raw = normalized(query);
  if (!raw) return false;
  const codeQuery = codeNormalized(query);
  return codeNormalized(product.sku).includes(codeQuery)
    || normalized(product.name).includes(raw)
    || normalized(product.category || "").includes(raw);
}

export function SaleModal({ products, clients, close, onSaved, onUnauthorized }: {
  products: Product[];
  clients: Client[];
  close: () => void;
  onSaved: (message: string) => Promise<void> | void;
  onUnauthorized: () => void;
}) {
  const [lines, setLines] = useState<SaleLine[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [productSearch, setProductSearch] = useState("");
  const [clientId, setClientId] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const searchResults = useMemo(
    () => productSearch.trim() ? products.filter((product) => matches(product, productSearch)).slice(0, 10) : [],
    [productSearch, products],
  );

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

  function addProduct(product: Product) {
    setLines(current => [...current, {
      key: nextKey,
      productId: String(product.id),
      presentation: defaultPresentation(product),
      quantity: "1",
    }]);
    setNextKey(value => value + 1);
    setProductSearch("");
  }

  function updateLine(key: number, patch: Partial<SaleLine>) {
    setLines(current => current.map(line => line.key === key ? { ...line, ...patch } : line));
  }

  function removeLine(key: number) {
    setLines(current => current.filter(line => line.key !== key));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!lines.length) {
      setError("Busca y agrega al menos un producto a la venta.");
      return;
    }
    if (lines.some(line => !line.productId || !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1)) {
      setError("Revisa que cada producto tenga una cantidad válida.");
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

        <div className="card" style={{ padding: 16, marginTop: 20, overflow: "visible" }}>
          <div style={{ marginBottom: 10 }}>
            <h3 style={{ margin: 0 }}>Buscar y agregar producto</h3>
            <small style={{ color: "var(--muted)" }}>Busca por código, nombre o categoría. El código funciona con o sin #.</small>
          </div>
          <input
            type="search"
            value={productSearch}
            onChange={event => setProductSearch(event.target.value)}
            onKeyDown={event => {
              if (event.key !== "Enter") return;
              const firstAvailable = searchResults.find(product => product.currentStock > 0);
              if (!firstAvailable) return;
              event.preventDefault();
              addProduct(firstAvailable);
            }}
            placeholder="Ej. #45821, brocas, tornillos..."
            autoComplete="off"
            style={{ width: "100%", minHeight: 54, padding: "0 15px", border: "1px solid var(--line)", borderRadius: 14, background: "var(--card)", color: "var(--text)", fontSize: 17 }}
          />
          {productSearch.trim() && <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {searchResults.length ? searchResults.map(product => {
              const baseUnit = defaultPresentation(product);
              return <button
                key={product.id}
                type="button"
                onClick={() => addProduct(product)}
                disabled={product.currentStock <= 0}
                style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto", gap: 12, alignItems: "center", width: "100%", padding: 12, border: "1px solid var(--line)", borderRadius: 12, background: "var(--card)", color: "var(--text)", textAlign: "left", cursor: product.currentStock > 0 ? "pointer" : "not-allowed", opacity: product.currentStock > 0 ? 1 : .6 }}
              >
                <span style={{ minWidth: 0 }}><code style={{ fontWeight: 800 }}>{product.sku}</code><strong style={{ display: "block", marginTop: 3 }}>{product.name}</strong><small style={{ display: "block", marginTop: 3, color: "var(--muted)" }}>{product.category || "Sin categoría"} · {product.currentStock} {unitLabel(baseUnit, product.currentStock !== 1)} disponibles</small></span>
                <span style={{ textAlign: "right" }}><b>{money.format(Number(product.salePrice || 0))}</b><small style={{ display: "block", color: "var(--muted)" }}>{product.currentStock > 0 ? "＋ Agregar" : "Agotado"}</small></span>
              </button>;
            }) : <div className="field-note">No encontré productos que coincidan con “{productSearch}”.</div>}
          </div>}
        </div>

        <div className="line-editor" style={{ marginTop: 20 }}>
          <div style={{ marginBottom: 12 }}><h3 style={{ margin: 0 }}>Productos de la venta</h3><small style={{ color: "var(--muted)" }}>{lines.length ? `${lines.length} partida(s) agregadas.` : "Todavía no has agregado productos."}</small></div>
          {lines.map((line, index) => {
            const preview = previews[index];
            const product = preview?.product;
            const baseUnit = defaultPresentation(product);
            const box = validBoxFactor(product?.boxFactor);
            const baseName = unitLabel(baseUnit);
            if (!product) return null;
            return <div key={line.key} className="card" style={{ padding: 14, marginBottom: 12, overflow: "visible" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <span><code style={{ fontWeight: 800 }}>{product.sku}</code><strong style={{ display: "block", marginTop: 3 }}>{product.name}</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>{product.category || "Sin categoría"} · stock {product.currentStock} {unitLabel(baseUnit, product.currentStock !== 1)}</small></span>
                <button type="button" className="mini danger" onClick={() => removeLine(line.key)}>Quitar</button>
              </div>
              <div className="form-grid">
                <label><span>Forma de venta *</span><select value={line.presentation} onChange={event => updateLine(line.key, { presentation: event.target.value })}><option value={baseUnit}>{baseName.charAt(0).toUpperCase() + baseName.slice(1)} · 1 = 1</option>{box ? <option value="caja">Caja · {box} {unitLabel(baseUnit, box !== 1)}</option> : null}</select></label>
                <label><span>Cantidad *</span><input inputMode="numeric" type="number" min="1" step="1" value={line.quantity} onChange={event => updateLine(line.key, { quantity: event.target.value })} required /></label>
                <label><span>Precio por {baseName}</span><input value={money.format(Number(product.salePrice || 0))} readOnly /></label>
              </div>
              <div className="field-note" style={{ marginTop: 10 }}>Se descontarán <b>{preview?.requested || 0} {unitLabel(baseUnit, (preview?.requested || 0) !== 1)}</b> · Se surtirán <b>{preview?.fulfilled || 0}</b> · Subtotal <b>{money.format(preview?.subtotal || 0)}</b>{preview?.pending ? <span className="danger-text"> · Faltan {preview.pending} {unitLabel(baseUnit, preview.pending !== 1)}</span> : null}</div>
            </div>;
          })}
        </div>

        <div className="card" style={{ padding: 16, marginTop: 18 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}><span><strong>Total de la venta</strong><small style={{ display: "block", color: "var(--muted)", marginTop: 3 }}>{lines.length} partida(s)</small></span><strong style={{ fontSize: 24 }}>{money.format(total)}</strong></div></div>
        <div className="modal-actions"><button type="button" className="ghost" onClick={close} disabled={busy}>Cancelar</button><button className="primary" disabled={busy || !lines.length}>{busy ? "Registrando venta…" : "Confirmar venta"}</button></div>
      </form>
    </div>
  </div>;
}
