"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Supplier = { id: number; name: string };
type ProductLink = {
  id: number;
  sku: string;
  name: string;
  cost: number;
  supplierId: number | null;
  supplierName: string | null;
  preferred: number;
  supplierProductCode: string;
  lastUnitCost: number;
  leadDays: number;
};
type Data = { suppliers: Supplier[]; products: ProductLink[]; singleSupplier: boolean };
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

export default function ProductSuppliersExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<ProductLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/product-suppliers", { cache: "no-store" });
    const json = await response.json() as Data & { error?: string };
    if (!response.ok) throw new Error(json.error || "No se pudieron cargar los proveedores por producto.");
    setData(json);
  }, []);

  useEffect(() => {
    function sync() {
      const heading = document.querySelector<HTMLElement>(".content h1")?.textContent?.trim();
      const content = document.querySelector<HTMLElement>(".content");
      const existing = document.querySelector<HTMLElement>("[data-civ-product-suppliers]");
      if (heading === "Proveedores" && content) {
        if (existing) { setMount(existing); return; }
        const node = document.createElement("div");
        node.dataset.civProductSuppliers = "1";
        content.appendChild(node);
        setMount(node);
      } else if (existing) {
        existing.remove();
        setMount(null);
      }
    }
    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { window.clearTimeout(timer); observer.disconnect(); document.querySelector<HTMLElement>("[data-civ-product-suppliers]")?.remove(); };
  }, []);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => { void load().catch((reason) => setError(reason instanceof Error ? reason.message : "No se pudo cargar.")); }, 0);
    return () => window.clearTimeout(timer);
  }, [mount, load]);

  const filtered = useMemo(() => {
    const value = query.trim().toLocaleLowerCase("es-MX");
    if (!value) return data?.products.slice(0, 12) ?? [];
    return data?.products.filter((product) => `${product.sku} ${product.name}`.toLocaleLowerCase("es-MX").includes(value)).slice(0, 30) ?? [];
  }, [data, query]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/product-suppliers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          productId: editing.id,
          supplierId: Number(form.get("supplierId")),
          supplierProductCode: form.get("supplierProductCode"),
          lastUnitCost: Number(form.get("lastUnitCost") || 0),
          leadDays: Number(form.get("leadDays") || 0),
        }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo guardar.");
      setEditing(null);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  }

  if (!mount) return null;
  return createPortal(<>
    <section className="card fill" style={{ marginTop: 18 }} aria-label="Proveedor por producto">
      <div className="card-head">
        <div><h2>Proveedor por producto</h2><p>{data?.singleSupplier && data.suppliers[0] ? `${data.suppliers[0].name} se usa automáticamente como proveedor predeterminado. La estructura queda lista para agregar más proveedores después.` : "Define el proveedor preferido de cada producto sin complicar el flujo diario."}</p></div>
      </div>
      {error && <div className="alert error">{error}<button onClick={() => setError("")}>×</button></div>}
      <div className="toolbar"><div className="search">⌕<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar código o producto" /></div></div>
      <div className="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Proveedor preferido</th><th>Último costo</th><th>Entrega</th><th>Acción</th></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><code>{product.sku}</code></td><td><strong>{product.name}</strong><small>{product.supplierProductCode ? `Código proveedor: ${product.supplierProductCode}` : "Sin código adicional"}</small></td><td>{product.supplierName || "Sin asignar"}</td><td>{money.format(Number(product.lastUnitCost || product.cost || 0))}</td><td>{product.leadDays > 0 ? `${product.leadDays} días` : "Sin estimar"}</td><td><button className="mini" onClick={() => setEditing(product)}>Configurar</button></td></tr>)}</tbody></table></div>
      {data && data.products.length > filtered.length && !query && <p className="table-note">Mostrando 12 productos. Usa el buscador para localizar cualquier código.</p>}
    </section>
    {editing && data && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setEditing(null); }}><div className="modal"><div className="modal-head"><div><p>PROVEEDOR PREFERIDO</p><h2>{editing.sku} · {editing.name}</h2></div><button onClick={() => setEditing(null)} disabled={busy}>×</button></div><form onSubmit={save}><div className="form-grid"><label><span>Proveedor *</span><select name="supplierId" defaultValue={String(editing.supplierId ?? data.suppliers[0]?.id ?? "")} required>{data.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label><label><span>Código del proveedor</span><input name="supplierProductCode" defaultValue={editing.supplierProductCode} /></label><label><span>Último costo</span><input name="lastUnitCost" type="number" min="0" step="0.01" defaultValue={editing.lastUnitCost || editing.cost || 0} /></label><label><span>Días aproximados de entrega</span><input name="leadDays" type="number" min="0" step="1" defaultValue={editing.leadDays || 0} /></label></div><div className="field-note" style={{ marginTop: 12 }}>Estos datos ayudan a CIV a preparar reabastecimientos y pedidos. No cambian inventario por sí solos.</div><div className="modal-actions"><button type="button" className="ghost" onClick={() => setEditing(null)} disabled={busy}>Cancelar</button><button className="primary" disabled={busy}>{busy ? "Guardando…" : "Guardar"}</button></div></form></div></div>}
  </>, mount);
}
