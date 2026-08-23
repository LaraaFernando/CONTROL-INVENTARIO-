"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SaleModal } from "./sale-modal";

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
type Movement = {
  id: number;
  type: string;
  productId: number;
  voided: number;
  createdAt: string;
};
type SalesData = {
  products: Product[];
  clients: Client[];
  movements: Movement[];
  auth?: { permissions?: Record<string, boolean> };
};

export default function SalesExperience() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SalesData | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const openingRef = useRef(false);

  const openSale = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    setLoading(true);
    setLoadError("");

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 12_000);

    try {
      const response = await fetch("/api/sales-context", {
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await response.json() as SalesData & { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar los productos.");
      if (!json.auth?.permissions?.["movements.sale"]) {
        throw new Error("Tu usuario no tiene permiso para registrar ventas.");
      }
      setData(json);
      setOpen(true);
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") {
        setLoadError("La carga de productos tardó demasiado. Intenta abrir la venta otra vez.");
      } else {
        setLoadError(reason instanceof Error ? reason.message : "No se pudo preparar la venta.");
      }
    } finally {
      window.clearTimeout(timeout);
      openingRef.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    function captureSaleButton(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) return;
      const title = document.querySelector(".content h1")?.textContent?.trim();
      if (title !== "Ventas") return;
      const label = button.textContent?.replace(/\s+/g, " ").trim() || "";
      if (!label.includes("Nuevo registro") && !label.includes("Registrar movimiento / venta") && !label.includes("Nueva venta")) return;
      event.preventDefault();
      event.stopPropagation();
      void openSale();
    }
    document.addEventListener("click", captureSaleButton, true);
    return () => document.removeEventListener("click", captureSaleButton, true);
  }, [openSale]);

  return <>
    {loading && <div className="update-banner"><span><strong>Preparando venta…</strong><small>Cargando productos y existencias actuales.</small></span></div>}
    {loadError && <div className="update-banner"><span><strong>No se pudo abrir la venta</strong><small>{loadError}</small></span><button onClick={() => setLoadError("")}>Cerrar</button></div>}
    {open && data && <SaleModal
      products={data.products}
      clients={data.clients}
      movements={data.movements ?? []}
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
