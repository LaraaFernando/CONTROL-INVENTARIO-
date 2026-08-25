"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type WarehouseItem = {
  id: number;
  quantity: number;
  sku: string;
  productName: string;
  unit: string;
};

type WarehouseOrder = {
  id: number;
  folio: string;
  clientName: string;
  status: string;
  totalAmount: number;
  createdBy: string;
  canceledReason: string;
  items: WarehouseItem[];
};

type WarehouseData = {
  orders: WarehouseOrder[];
  canManageWarehouse: boolean;
  summary: { newOrders: number };
  error?: string;
};

type BadgeNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

const LAST_ORDER_KEY = "civ-warehouse-last-order-id";
const NOTIFICATIONS_KEY = "civ-warehouse-notifications";
const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });

function isSaleCanceled(order: WarehouseOrder) {
  return order.status === "cancelado" && order.canceledReason.startsWith("Venta anulada por completo");
}

function findSection(label: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("section")).find((section) =>
    (section.textContent || "").includes(label),
  );
}

function hideCanceledOrdersFromFieldList(orders: WarehouseOrder[]) {
  const canceled = new Set(orders.filter(isSaleCanceled).map((order) => order.folio));
  if (!canceled.size) return;
  const section = findSection("Pedidos de campo");
  if (!section) return;
  section.querySelectorAll<HTMLElement>("code").forEach((code) => {
    const folio = (code.textContent || "").trim();
    if (!canceled.has(folio)) return;
    const card = code.parentElement?.parentElement as HTMLElement | null;
    if (card) {
      card.style.display = "none";
      card.dataset.civCanceledSaleHidden = "1";
    }
  });
}

function appendCanceledSaleNote(article: HTMLElement, order: WarehouseOrder) {
  if (article.querySelector("[data-civ-canceled-sale-note]")) return;

  Array.from(article.querySelectorAll<HTMLElement>("span")).forEach((span) => {
    if ((span.textContent || "").trim() === "Cancelado") span.textContent = "Venta anulada";
  });

  const note = document.createElement("div");
  note.dataset.civCanceledSaleNote = "1";
  note.style.marginTop = "12px";
  note.style.padding = "12px";
  note.style.borderRadius = "12px";
  note.style.border = "1px solid color-mix(in srgb, #dc2626 45%, var(--line))";
  note.style.background = "color-mix(in srgb, #dc2626 8%, var(--card))";

  const head = document.createElement("div");
  head.style.display = "flex";
  head.style.justifyContent = "space-between";
  head.style.gap = "10px";
  const title = document.createElement("strong");
  title.textContent = "Venta anulada · movimiento revertido";
  const amount = document.createElement("strong");
  amount.textContent = money.format(-Math.abs(Number(order.totalAmount || 0)));
  head.append(title, amount);
  note.append(head);

  const explanation = document.createElement("small");
  explanation.style.display = "block";
  explanation.style.marginTop = "5px";
  explanation.textContent = "Este pedido queda solo como historial. Ya no debe surtirse ni contabilizarse como venta.";
  note.append(explanation);

  const lines = document.createElement("div");
  lines.style.display = "grid";
  lines.style.gap = "4px";
  lines.style.marginTop = "8px";
  order.items.forEach((item) => {
    const row = document.createElement("small");
    row.textContent = `−${Math.abs(Number(item.quantity || 0))} ${item.unit || "unidad"} · ${item.sku} · ${item.productName}`;
    lines.append(row);
  });
  note.append(lines);

  const reason = order.canceledReason.replace(/^Venta anulada por completo:\s*/i, "").trim();
  if (reason) {
    const reasonRow = document.createElement("small");
    reasonRow.style.display = "block";
    reasonRow.style.marginTop = "8px";
    reasonRow.textContent = `Motivo: ${reason}`;
    note.append(reasonRow);
  }

  article.append(note);
}

function decorateWarehouseHistory(orders: WarehouseOrder[]) {
  const canceled = new Map(orders.filter(isSaleCanceled).map((order) => [order.folio, order]));
  if (!canceled.size) return;
  const section = findSection("Almacén · pedidos por atender");
  if (!section) return;
  section.querySelectorAll<HTMLElement>("article").forEach((article) => {
    const folio = (article.querySelector("code")?.textContent || "").trim();
    const order = canceled.get(folio);
    if (order) appendCanceledSaleNote(article, order);
  });
}

function syncCanceledSaleDisplay(orders: WarehouseOrder[]) {
  hideCanceledOrdersFromFieldList(orders);
  decorateWarehouseHistory(orders);
}

async function showSystemNotification(order: WarehouseOrder, count: number) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (!("serviceWorker" in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification(count > 1 ? `${count} pedidos nuevos en CIV` : "Nuevo pedido en CIV", {
      body: count > 1
        ? `Último: ${order.folio} · ${order.clientName} · ${order.createdBy}`
        : `${order.folio} · ${order.clientName} · levantado por ${order.createdBy}`,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: `civ-order-${order.id}`,
      data: { url: "/" },
    });
  } catch {
    // El aviso dentro de CIV sigue funcionando aunque el sistema bloquee la notificación.
  }
}

export default function WarehouseAlertsExperience() {
  const [data, setData] = useState<WarehouseData | null>(null);
  const [notice, setNotice] = useState("");
  const [systemEnabled, setSystemEnabled] = useState(false);
  const initialized = useRef(false);
  const lastOrderId = useRef(0);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/field-order-warehouse", { cache: "no-store" });
      const json = await response.json() as WarehouseData;
      if (!response.ok) throw new Error(json.error || "No se pudieron revisar los pedidos nuevos.");
      setData(json);
      if (!json.canManageWarehouse) return;

      const pending = json.orders.filter((order) => order.status === "levantado");
      const maxId = pending.reduce((max, order) => Math.max(max, Number(order.id || 0)), 0);
      const stored = Number(window.localStorage.getItem(LAST_ORDER_KEY) || 0);

      if (!initialized.current) {
        initialized.current = true;
        lastOrderId.current = stored > 0 ? stored : maxId;
        if (!stored && maxId) window.localStorage.setItem(LAST_ORDER_KEY, String(maxId));
      }

      const newcomers = pending
        .filter((order) => Number(order.id) > lastOrderId.current)
        .sort((left, right) => Number(left.id) - Number(right.id));

      if (newcomers.length) {
        const newest = newcomers[newcomers.length - 1];
        const nextLast = Math.max(lastOrderId.current, ...newcomers.map((order) => Number(order.id)));
        lastOrderId.current = nextLast;
        window.localStorage.setItem(LAST_ORDER_KEY, String(nextLast));
        setNotice(newcomers.length === 1
          ? `Nuevo pedido ${newest.folio} · ${newest.clientName} · levantado por ${newest.createdBy}.`
          : `${newcomers.length} pedidos nuevos. Último: ${newest.folio} · ${newest.clientName}.`);

        const wantsSystem = window.localStorage.getItem(NOTIFICATIONS_KEY) === "1";
        if (wantsSystem) await showSystemNotification(newest, newcomers.length);
      }

      const badgeNavigator = navigator as BadgeNavigator;
      if (badgeNavigator.setAppBadge) {
        try { await badgeNavigator.setAppBadge(Number(json.summary?.newOrders || 0)); } catch { /* no-op */ }
      }

      const enabled = "Notification" in window
        && Notification.permission === "granted"
        && window.localStorage.getItem(NOTIFICATIONS_KEY) === "1";
      setSystemEnabled(enabled);
    } catch {
      // No interrumpir la operación normal de CIV si el sondeo temporal falla.
    }
  }, []);

  useEffect(() => {
    const first = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 20_000);
    const onFocus = () => { void load(); };
    const onVisibility = () => { if (document.visibilityState === "visible") void load(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load]);

  useEffect(() => {
    if (!data?.orders?.length) return;
    const sync = () => syncCanceledSaleDisplay(data.orders);
    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, [data]);

  async function enableNotifications() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setNotice("Este dispositivo no permite notificaciones del sistema desde CIV; los avisos dentro de la aplicación seguirán activos.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        window.localStorage.setItem(NOTIFICATIONS_KEY, "1");
        setSystemEnabled(true);
        setNotice("Notificaciones de pedidos activadas para este celular.");
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification("CIV · Almacén", {
          body: "Las notificaciones de pedidos quedaron activadas en este celular.",
          icon: "/icon-192.png",
          badge: "/icon-192.png",
          tag: "civ-orders-enabled",
          data: { url: "/" },
        });
      } else {
        window.localStorage.setItem(NOTIFICATIONS_KEY, "0");
        setSystemEnabled(false);
        setNotice("El celular no autorizó notificaciones del sistema. CIV seguirá mostrando avisos dentro de la aplicación.");
      }
    } catch {
      setNotice("No se pudo activar la notificación del sistema. CIV seguirá mostrando avisos dentro de la aplicación.");
    }
  }

  function openOrders() {
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((candidate) =>
      (candidate.textContent || "").replace(/\s+/g, " ").trim().includes("Pedidos"),
    );
    button?.click();
    setNotice("");
    const badgeNavigator = navigator as BadgeNavigator;
    if (badgeNavigator.clearAppBadge) void badgeNavigator.clearAppBadge().catch(() => undefined);
  }

  if (!data?.canManageWarehouse) return null;

  const canOfferSystem = "Notification" in window
    && "serviceWorker" in navigator
    && Notification.permission !== "denied";

  return <>
    {canOfferSystem && !systemEnabled && <div className="update-banner">
      <span><strong>Notificaciones de almacén</strong><small>Recibe un aviso en este celular cuando otro usuario levante un pedido.</small></span>
      <button type="button" onClick={() => void enableNotifications()}>Activar notificaciones</button>
    </div>}
    {notice && <div className="update-banner">
      <span><strong>Almacén · pedido nuevo</strong><small>{notice}</small></span>
      <button type="button" onClick={openOrders}>Ver pedidos</button>
      <button type="button" onClick={() => setNotice("")}>Cerrar</button>
    </div>}
  </>;
}
