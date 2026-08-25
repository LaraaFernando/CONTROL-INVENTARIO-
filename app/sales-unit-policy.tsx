"use client";

import { useEffect } from "react";
import { normalizeCommercialUnit } from "./commercial-units";

type ProductPolicy = {
  id: number;
  unit: string;
};

type ProductData = {
  products?: ProductPolicy[];
};

type SaleItem = {
  productId?: unknown;
  presentation?: unknown;
  quantity?: unknown;
};

type SalePayload = {
  items?: SaleItem[];
  [key: string]: unknown;
};

function compact(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function requestPath(input: RequestInfo | URL) {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return input.url;
}

export default function SalesUnitPolicy() {
  useEffect(() => {
    const productUnits = new Map<number, string>();
    const nativeFetch = window.fetch.bind(window);

    function rememberProducts(data: ProductData | null) {
      for (const product of data?.products ?? []) {
        const id = Number(product.id || 0);
        if (!id) continue;
        productUnits.set(id, normalizeCommercialUnit(product.unit));
      }
    }

    async function ensureProducts(productIds: number[]) {
      if (productIds.every((id) => productUnits.has(id))) return;
      try {
        const response = await nativeFetch("/api/data", { cache: "no-store" });
        if (!response.ok) return;
        rememberProducts(await response.json() as ProductData);
      } catch {
        // Si falla esta consulta, la API conserva sus validaciones normales.
      }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = requestPath(input);
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      let nextInit = init;

      if (method === "POST" && path.includes("/api/sales") && typeof init?.body === "string") {
        try {
          const payload = JSON.parse(init.body) as SalePayload;
          const items = Array.isArray(payload.items) ? payload.items : [];
          const productIds = items.map((item) => Number(item.productId || 0)).filter(Boolean);
          await ensureProducts(productIds);
          payload.items = items.map((item) => {
            const productId = Number(item.productId || 0);
            const unit = productUnits.get(productId);
            return unit ? { ...item, presentation: unit } : item;
          });
          nextInit = { ...init, body: JSON.stringify(payload) };
        } catch {
          // No alterar solicitudes que no tengan el formato esperado.
        }
      }

      const response = await nativeFetch(input, nextInit);

      if (response.ok && method === "GET" && path.includes("/api/sales-context")) {
        void response.clone().json().then((data) => rememberProducts(data as ProductData)).catch(() => undefined);
      }

      return response;
    };

    function clarifyInterface() {
      document.querySelectorAll<HTMLLabelElement>(".modal form label").forEach((label) => {
        const caption = label.querySelector<HTMLElement>(":scope > span");
        const text = compact(caption?.textContent);
        if (!caption) return;

        if (text === "Forma de venta *") {
          caption.textContent = "Unidad de venta *";
          const select = label.querySelector<HTMLSelectElement>("select");
          select?.querySelectorAll<HTMLOptionElement>('option[value="caja"]').forEach((option) => option.remove());
          if (select?.value === "caja" && select.options.length) {
            select.value = select.options[0].value;
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (text === "Unidad base") {
          caption.textContent = "Unidad de venta";
        } else if (text === "Piezas por caja") {
          caption.textContent = "Contenido por caja (solo referencia)";
        } else if (text === "Piezas por juego") {
          caption.textContent = "Contenido por juego (solo referencia)";
        }
      });

      document.querySelectorAll<HTMLElement>(".modal").forEach((modal) => {
        const title = compact(modal.querySelector<HTMLElement>(".modal-head h2")?.textContent);
        const form = modal.querySelector<HTMLFormElement>("form");
        if (!form || form.querySelector("[data-civ-packaging-note]")) return;

        if (title === "Levantar pedido" || title === "Venta con múltiples productos") {
          const note = document.createElement("div");
          note.dataset.civPackagingNote = "1";
          note.className = "field-note";
          note.style.marginBottom = "14px";
          note.textContent = "La cantidad se captura por unidad de venta (pieza, unidad o juego). El contenido de la caja es solo información de empaque y nunca obliga a vender la caja completa.";
          form.prepend(note);
        }

        if (title === "Registrar producto" || title === "Modificar producto") {
          const note = document.createElement("div");
          note.dataset.civPackagingNote = "1";
          note.className = "field-note wide";
          note.style.margin = "0 0 14px";
          note.textContent = "Configura la unidad en la que venderás este producto. El contenido por caja/juego es informativo para saber cómo llega empacado; no multiplica automáticamente un pedido.";
          form.prepend(note);
        }
      });

      document.querySelectorAll<HTMLElement>(".content th").forEach((cell) => {
        if (compact(cell.textContent) === "Presentaciones") cell.textContent = "Empaque / referencia";
      });
    }

    const observer = new MutationObserver(clarifyInterface);
    observer.observe(document.body, { childList: true, subtree: true });
    clarifyInterface();

    return () => {
      observer.disconnect();
      window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
