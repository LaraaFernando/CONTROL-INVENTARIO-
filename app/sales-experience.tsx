"use client";

import { useEffect, useState } from "react";
import { SaleModal } from "./sale-modal";

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
type SalesData = {
  products: Product[];
  clients: Client[];
  auth?: { permissions?: Record<string, boolean> };
};

export default function SalesExperience() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");

  async function openSale() {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const json = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar los productos.");
      if (!json.auth?.permissions?.["movements.sale"]) return;
      setData(json);
      setOpen(true);
    } catch (reason) {
      setLoadError(reason instanceof Error ? reason.message : "No se pudo preparar la venta.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function captureSaleButton(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) return;
      const title = document.querySelector(".content h1")?.textContent?.trim();
      if (title !== "Ventas") return;
      const label = button.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!label.includes("Nuevo registro") && !label.includes("Registrar movimiento / venta")) return;
      event.preventDefault();
      event.stopPropagation();
      void openSale();
    }
    document.addEventListener("click", captureSaleButton, true);
    return () => document.removeEventListener("click", captureSaleButton, true);
  }, []);

  return <>
    {loading && <div className="update-banner"><span><strong>Preparando venta…</strong><small>Cargando productos y existencias actuales.</small></span></div>}
    {loadError && <div className="update-banner"><span><strong>No se pudo abrir la venta</strong><small>{loadError}</small></span><button onClick={() => setLoadError("")}>Cerrar</button></div>}
    {open && data && <SaleModal
      products={data.products}
      clients={data.clients}
      close={() => setOpen(false)}
      onUnauthorized={() => window.location.reload()}
      onSaved={async message => {
        setOpen(false);
        window.alert(message);
        window.location.reload();
      }}
    />}
  </>;
}
