"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeCommercialUnit, unitLabel } from "./commercial-units";

type ProductRow = {
  id: number; sku: string; name: string; category: string; unit: string; currentStock: number;
  minimumStock: number; sold30: number; sales30: number; lastSaleDate: string | null;
  daysCover: number | null; rotation: "alta" | "media" | "baja" | "sin_movimiento";
};
type Data = {
  today: string; startDate: string;
  summary: { salesAmount30:number; unitsSold30:number; productsSold30:number; activeProducts:number; noMovement30:number; inventoryValue:number|null };
  rotation: { high:number; medium:number; low:number; none:number };
  topProducts: ProductRow[];
  lowRotation: ProductRow[];
};
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function rotationLabel(value: ProductRow["rotation"]) {
  return value === "alta" ? "Alta" : value === "media" ? "Media" : value === "baja" ? "Baja" : "Sin movimiento";
}

export default function BusinessInsightsExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch("/api/business-insights", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo calcular el reporte.");
      setData(json);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "No se pudo calcular el reporte."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    function sync() {
      const heading = document.querySelector<HTMLElement>(".content h1")?.textContent?.trim();
      const content = document.querySelector<HTMLElement>(".content");
      const existing = document.querySelector<HTMLElement>("[data-civ-business-insights]");
      const home = heading === "Inicio" || heading === "Resumen";
      if (home && content) {
        if (existing) { setMount(existing); return; }
        const node = document.createElement("div");
        node.dataset.civBusinessInsights = "1";
        content.appendChild(node);
        setMount(node);
      } else if (existing) { existing.remove(); setMount(null); }
    }
    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { window.clearTimeout(timer); observer.disconnect(); document.querySelector<HTMLElement>("[data-civ-business-insights]")?.remove(); };
  }, []);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [mount, load]);

  if (!mount) return null;
  return createPortal(<>
    <section className="card fill" style={{ marginTop: 18 }} aria-label="Pulso del negocio">
      <div className="card-head"><div><p style={{ margin:0, fontSize:12, fontWeight:800, letterSpacing:".08em", color:"var(--muted)" }}>PULSO DEL NEGOCIO</p><h2 style={{ marginTop:4 }}>¿Cómo se está moviendo CIV?</h2><p>Resumen de los últimos 30 días. El detalle queda aquí para no llenar la navegación de módulos.</p></div><button className="secondary" onClick={() => setOpen(true)} disabled={!data}>Ver reporte</button></div>
      {error && <div className="alert error">{error}<button onClick={() => setError("")}>×</button></div>}
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))", gap:10 }}>
        <article className="card" style={{ padding:14 }}><small>Ventas 30 días</small><strong style={{ display:"block", fontSize:22, marginTop:4 }}>{data ? money.format(data.summary.salesAmount30) : loading ? "…" : "—"}</strong></article>
        <article className="card" style={{ padding:14 }}><small>Unidades vendidas</small><strong style={{ display:"block", fontSize:22, marginTop:4 }}>{data?.summary.unitsSold30 ?? (loading ? "…" : "—")}</strong></article>
        <article className="card" style={{ padding:14 }}><small>Productos con venta</small><strong style={{ display:"block", fontSize:22, marginTop:4 }}>{data ? `${data.summary.productsSold30} / ${data.summary.activeProducts}` : loading ? "…" : "—"}</strong></article>
        <article className="card" style={{ padding:14 }}><small>Sin movimiento 30 días</small><strong style={{ display:"block", fontSize:22, marginTop:4 }}>{data?.summary.noMovement30 ?? (loading ? "…" : "—")}</strong></article>
      </div>
      {data?.topProducts[0] && <div className="field-note" style={{ marginTop:12 }}>Más vendido por importe: <b>{data.topProducts[0].sku} · {data.topProducts[0].name}</b> · {money.format(data.topProducts[0].sales30)}</div>}
    </section>

    {open && data && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}><div className="modal operations-modal"><div className="modal-head"><div><p>REPORTE SIMPLE · 30 DÍAS</p><h2>Ventas y rotación</h2><small>Información operativa para decidir qué mover, reponer o revisar.</small></div><button onClick={() => setOpen(false)}>×</button></div>
      <div style={{ padding:"0 4px 18px" }}>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))", gap:10, marginBottom:18 }}>
          <div className="card" style={{ padding:12 }}><small>Rotación alta</small><strong style={{ display:"block", fontSize:22 }}>{data.rotation.high}</strong></div>
          <div className="card" style={{ padding:12 }}><small>Rotación media</small><strong style={{ display:"block", fontSize:22 }}>{data.rotation.medium}</strong></div>
          <div className="card" style={{ padding:12 }}><small>Rotación baja</small><strong style={{ display:"block", fontSize:22 }}>{data.rotation.low}</strong></div>
          <div className="card" style={{ padding:12 }}><small>Sin movimiento</small><strong style={{ display:"block", fontSize:22 }}>{data.rotation.none}</strong></div>
          {data.summary.inventoryValue !== null && <div className="card" style={{ padding:12 }}><small>Inventario valorizado</small><strong style={{ display:"block", fontSize:18 }}>{money.format(data.summary.inventoryValue)}</strong></div>}
        </div>

        <h3>Productos con más movimiento</h3>
        <div className="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Vendidos</th><th>Venta</th><th>Rotación</th><th>Existencia</th></tr></thead><tbody>{data.topProducts.map((row) => { const unit=normalizeCommercialUnit(row.unit); return <tr key={row.id}><td><code>{row.sku}</code></td><td><strong>{row.name}</strong><small>{row.category || "General"}</small></td><td>{row.sold30} {unitLabel(unit,row.sold30!==1)}</td><td>{money.format(row.sales30)}</td><td>{rotationLabel(row.rotation)}</td><td>{row.currentStock}</td></tr>; })}</tbody></table></div>

        <h3 style={{ marginTop:20 }}>Para revisar</h3>
        <p style={{ color:"var(--muted)" }}>Productos con rotación baja o sin venta en los últimos 30 días. No significa que deban eliminarse; solo ayuda a no sobrecomprar.</p>
        <div className="table-wrap"><table><thead><tr><th>Código</th><th>Producto</th><th>Rotación</th><th>Vendidos</th><th>Existencia</th><th>Última venta</th></tr></thead><tbody>{data.lowRotation.map((row) => <tr key={row.id}><td><code>{row.sku}</code></td><td>{row.name}</td><td>{rotationLabel(row.rotation)}</td><td>{row.sold30}</td><td>{row.currentStock}</td><td>{row.lastSaleDate || "Sin registro"}</td></tr>)}</tbody></table></div>
        <div className="field-note" style={{ marginTop:16 }}>Criterio de rotación: CIV compara las ventas de 30 días contra la existencia actual. Alta ≈ hasta 30 días de inventario; media ≈ hasta 90; baja = más de 90; sin movimiento = sin ventas en el periodo.</div>
      </div>
      <div className="modal-actions"><button className="primary" onClick={() => setOpen(false)}>Cerrar</button></div>
    </div></div>}
  </>, mount);
}
