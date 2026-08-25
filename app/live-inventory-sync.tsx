"use client";

import { useEffect } from "react";

type InventoryUpdateDetail = {
  action?: string;
  sku?: string;
};

type InventorySnapshot = {
  products?: Array<{ currentStock: number; minimumStock: number }>;
};

const PRODUCT_ACTIONS = new Set(["add_product", "edit_product", "delete_product"]);

function compact(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function findHomeActionsSection() {
  const sections = Array.from(document.querySelectorAll<HTMLElement>(".content section"));
  return sections.find((section) => {
    const labels = Array.from(section.querySelectorAll("button strong"), (node) => compact(node.textContent));
    return labels.includes("Levantar pedido")
      || (labels.includes("Pedidos") && labels.includes("Inventario") && labels.includes("Clientes"));
  }) ?? null;
}

function prioritizeHomeActions() {
  const heading = document.querySelector<HTMLElement>(".content > header h1, .content h1");
  if (compact(heading?.textContent) !== "Inicio") return;

  const actions = findHomeActionsSection();
  const home = actions?.parentElement as HTMLElement | null;
  const content = document.querySelector<HTMLElement>(".content");
  const header = content?.querySelector<HTMLElement>(":scope > header");
  if (!actions || !home || !content || !header) return;

  if (home.firstElementChild !== actions) home.prepend(actions);
  if (header.nextElementSibling !== home) header.insertAdjacentElement("afterend", home);
}

function updateHomeInventorySummary(snapshot: InventorySnapshot | null) {
  if (!snapshot?.products) return;
  const outOfStock = snapshot.products.filter((product) => product.currentStock === 0).length;
  const lowStock = snapshot.products.filter(
    (product) => product.currentStock > 0 && product.currentStock <= product.minimumStock,
  ).length;

  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>(".content button"));
  const updateCard = (label: string, value: number) => {
    const button = buttons.find((candidate) => compact(candidate.textContent).includes(label));
    const number = button?.querySelector<HTMLElement>("strong");
    if (number) number.textContent = String(value);
  };
  updateCard("Poco inventario", lowStock);
  updateCard("Agotados", outOfStock);
}

export default function LiveInventorySync() {
  useEffect(() => {
    let latestSnapshot: InventorySnapshot | null = null;
    const nativeFetch = window.fetch.bind(window);

    async function refreshSnapshot() {
      try {
        const response = await nativeFetch("/api/data", { cache: "no-store" });
        if (!response.ok) return;
        latestSnapshot = await response.json() as InventorySnapshot;
        updateHomeInventorySummary(latestSnapshot);
      } catch {
        // La vista principal de Inventario mantiene su propio refresco.
      }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await nativeFetch(input, init);
      try {
        const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
        const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
        if (response.ok && method === "POST" && url.includes("/api/data") && typeof init?.body === "string") {
          const payload = JSON.parse(init.body) as InventoryUpdateDetail;
          if (payload.action && PRODUCT_ACTIONS.has(payload.action)) {
            window.dispatchEvent(new CustomEvent<InventoryUpdateDetail>("civ:inventory-updated", { detail: payload }));
            window.setTimeout(() => { void refreshSnapshot(); }, 0);
          }
        }
      } catch {
        // No interferir con la operación original si el cuerpo no es JSON.
      }
      return response;
    };

    const observer = new MutationObserver(() => {
      prioritizeHomeActions();
      updateHomeInventorySummary(latestSnapshot);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    prioritizeHomeActions();

    return () => {
      observer.disconnect();
      window.fetch = nativeFetch;
    };
  }, []);

  return null;
}
