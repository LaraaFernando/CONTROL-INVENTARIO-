"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./sale-delivery-experience.module.css";

type DeliveryStatus = "preparando" | "transito" | "entregada";
type Delivery = {
  saleId: number;
  reference: string;
  clientName: string;
  totalAmount: number;
  businessDate: string;
  createdAt: string;
  lineCount: number;
  status: DeliveryStatus;
  inTransitAt: string | null;
  deliveredAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
};
type DeliveryData = {
  deliveries: Delivery[];
  summary: { preparing: number; inTransit: number; delivered: number };
  error?: string;
};

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const shortDate = (value: string) => {
  if (!value) return "—";
  const iso = value.length === 10 ? `${value}T12:00:00Z` : `${value.replace(" ", "T")}Z`;
  return new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(iso));
};

function statusText(status: DeliveryStatus) {
  if (status === "transito") return "En tránsito";
  if (status === "entregada") return "Entregada completa";
  return "Preparando";
}

export default function SaleDeliveryExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<DeliveryData | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyReference, setBusyReference] = useState("");
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/sale-delivery", { cache: "no-store" });
      const json = await response.json() as DeliveryData;
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar las entregas.");
      setData(json);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar las entregas.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const syncMount = () => {
      const heading = document.querySelector<HTMLElement>(".content h1");
      const content = document.querySelector<HTMLElement>(".content");
      if (!content || heading?.textContent?.trim() !== "Ventas") {
        setMount((current) => current ? null : current);
        return;
      }

      let target = content.querySelector<HTMLElement>("[data-civ-sale-delivery-mount]");
      if (!target) {
        target = document.createElement("div");
        target.dataset.civSaleDeliveryMount = "1";
        const header = content.querySelector(":scope > header");
        if (header) header.insertAdjacentElement("afterend", target);
        else content.prepend(target);
      }
      setMount((current) => current === target ? current : target);
    };

    const timer = window.setTimeout(syncMount, 0);
    const observer = new MutationObserver(syncMount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [mount, load]);

  const visible = useMemo(() => {
    const rows = data?.deliveries ?? [];
    return showAll ? rows : rows.slice(0, 8);
  }, [data, showAll]);

  const update = useCallback(async (delivery: Delivery, status: "transito" | "entregada") => {
    let completeConfirmed = false;
    if (status === "entregada") {
      completeConfirmed = window.confirm(
        `¿Confirmas que ${delivery.clientName} recibió completa la mercancía de la venta ${delivery.reference}?`,
      );
      if (!completeConfirmed) return;
    }

    setBusyReference(delivery.reference);
    setError("");
    try {
      const response = await fetch("/api/sale-delivery", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reference: delivery.reference, status, completeConfirmed }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo actualizar el estado de entrega.");
      await load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo actualizar el estado de entrega.");
    } finally {
      setBusyReference("");
    }
  }, [load]);

  if (!mount) return null;

  return createPortal(
    <section className={styles.panel} aria-label="Seguimiento de entregas de ventas">
      <div className={styles.head}>
        <div>
          <h2>Entregas de ventas</h2>
          <p>Controla si la mercancía sigue en almacén, va en camino o ya fue recibida completa.</p>
        </div>
        <button className={styles.refresh} type="button" onClick={() => void load()} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </div>

      {data && <div className={styles.summary}>
        <div className={styles.preparingSummary}><strong>{data.summary.preparing}</strong><span>Preparando</span></div>
        <div className={styles.transitSummary}><strong>{data.summary.inTransit}</strong><span>En tránsito</span></div>
        <div className={styles.deliveredSummary}><strong>{data.summary.delivered}</strong><span>Entregadas</span></div>
      </div>}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.list}>
        {visible.map((delivery) => {
          const busy = busyReference === delivery.reference;
          const statusClass = delivery.status === "preparando"
            ? styles.statusPre
            : delivery.status === "transito"
              ? styles.statusTransit
              : styles.statusDelivered;
          return <article key={delivery.reference} className={`${styles.sale} ${styles[delivery.status]}`}>
            <div className={styles.main}>
              <div className={styles.topline}>
                <code>{delivery.reference}</code>
                <span className={`${styles.status} ${statusClass}`}>● {statusText(delivery.status)}</span>
              </div>
              <span className={styles.client}>{delivery.clientName}</span>
              <span className={styles.meta}>
                {shortDate(delivery.businessDate || delivery.createdAt)} · {delivery.lineCount} partida{delivery.lineCount === 1 ? "" : "s"} · {money.format(delivery.totalAmount)}
              </span>
            </div>
            <div className={styles.right}>
              {delivery.status === "preparando" && <button
                type="button"
                className={styles.action}
                disabled={busy}
                onClick={() => void update(delivery, "transito")}
              >{busy ? "Guardando…" : "Marcar en tránsito"}</button>}
              {delivery.status === "transito" && <button
                type="button"
                className={`${styles.action} ${styles.complete}`}
                disabled={busy}
                onClick={() => void update(delivery, "entregada")}
              >{busy ? "Guardando…" : "Confirmar entrega completa"}</button>}
            </div>
          </article>;
        })}

        {!loading && data && !data.deliveries.length && <div className={styles.empty}>Aún no hay ventas activas para dar seguimiento.</div>}
      </div>

      {data && data.deliveries.length > 8 && <button className={styles.more} type="button" onClick={() => setShowAll((value) => !value)}>
        {showAll ? "Mostrar menos" : `Ver todas (${data.deliveries.length})`}
      </button>}
    </section>,
    mount,
  );
}
