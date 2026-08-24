"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Product = {
  id: number;
  sku: string;
  name: string;
  unit: string;
  currentStock: number;
  reservedStock: number;
  availableStock: number;
};
type Context = { products: Product[]; error?: string };

export default function InventoryReservationExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/field-orders", { cache: "no-store" });
      const json = await response.json() as Context;
      if (!response.ok) throw new Error(json.error || "No se pudo cargar la disponibilidad.");
      setProducts(json.products ?? []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar la disponibilidad.");
    }
  }, []);

  useEffect(() => {
    const sync = () => {
      const heading = document.querySelector<HTMLElement>(".content h1");
      const content = document.querySelector<HTMLElement>(".content");
      if (!content || heading?.textContent?.trim() !== "Inventario") {
        setMount((current) => current ? null : current);
        return;
      }
      let target = content.querySelector<HTMLElement>("[data-civ-reservation-mount]");
      if (!target) {
        target = document.createElement("div");
        target.dataset.civReservationMount = "1";
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

  const reserved = useMemo(() => products.filter((product) => product.reservedStock > 0), [products]);
  const totalPhysical = useMemo(() => products.reduce((sum, product) => sum + product.currentStock, 0), [products]);
  const totalReserved = useMemo(() => products.reduce((sum, product) => sum + product.reservedStock, 0), [products]);
  const totalAvailable = useMemo(() => products.reduce((sum, product) => sum + product.availableStock, 0), [products]);

  if (!mount) return null;
  return createPortal(
    <section style={{ marginBottom: 16, padding: 15, border: "1px solid var(--line)", borderRadius: 16, background: "var(--card)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <div><strong style={{ display: "block", fontSize: 18 }}>Disponibilidad real</strong><small style={{ color: "var(--muted)" }}>Físico − apartado en pedidos = disponible para vender.</small></div>
        <button type="button" className="mini" onClick={() => void load()}>Actualizar</button>
      </div>
      {error && <div className="alert error" style={{ marginTop: 10 }}>{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: 8, marginTop: 12 }}>
        <div style={{ padding: 10, borderRadius: 12, background: "var(--soft)" }}><strong style={{ display: "block", fontSize: 20 }}>{totalPhysical}</strong><small>Físico</small></div>
        <div style={{ padding: 10, borderRadius: 12, background: "var(--soft)" }}><strong style={{ display: "block", fontSize: 20 }}>{totalReserved}</strong><small>Apartado</small></div>
        <div style={{ padding: 10, borderRadius: 12, background: "var(--soft)" }}><strong style={{ display: "block", fontSize: 20 }}>{totalAvailable}</strong><small>Disponible</small></div>
      </div>
      {reserved.length > 0 && <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
        {reserved.slice(0, 6).map((product) => <div key={product.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, padding: 9, borderTop: "1px solid var(--line)" }}><span><code>{product.sku}</code><strong style={{ display: "block" }}>{product.name}</strong></span><span style={{ textAlign: "right" }}><b>{product.availableStock} disponibles</b><small style={{ display: "block", color: "var(--muted)" }}>{product.currentStock} físico · {product.reservedStock} apartado</small></span></div>)}
      </div>}
    </section>,
    mount,
  );
}
