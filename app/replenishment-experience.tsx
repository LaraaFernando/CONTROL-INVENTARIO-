"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeCommercialUnit, unitLabel } from "./commercial-units";
import styles from "./replenishment-experience.module.css";

type AttentionStatus = "agotado" | "bajo_minimo" | "proximo_minimo";

type ReplenishmentItem = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  minimumStock: number;
  targetStock: number;
  sold30: number;
  averageDailySales: number;
  daysToMinimum: number | null;
  suggestedOrder: number;
  status: AttentionStatus;
};

type ReplenishmentData = {
  calculatedAt: string;
  windowStart: string;
  attention: ReplenishmentItem[];
  summary: {
    outOfStock: number;
    belowMinimum: number;
    approachingMinimum: number;
  };
  canManageOrders: boolean;
};

function buttonText(button: Element) {
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function findNavigationButton(label: string) {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sidebar nav > button, .mobile-nav > button"),
  );
  return candidates.find((button) => buttonText(button).includes(label)) ?? null;
}

function setReactInput(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function statusCopy(status: AttentionStatus) {
  if (status === "agotado") return { title: "Agotado", detail: "No hay existencia disponible" };
  if (status === "bajo_minimo") return { title: "Debajo del mínimo", detail: "Conviene reabastecer ahora" };
  return { title: "Próximo al mínimo", detail: "El ritmo de venta puede llevarlo al mínimo pronto" };
}

export default function ReplenishmentExperience() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<ReplenishmentData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/replenishment", { cache: "no-store" });
      const json = await response.json() as ReplenishmentData & { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo calcular el reabastecimiento.");
      setData(json);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo calcular el reabastecimiento.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    function syncMount() {
      const heading = document.querySelector<HTMLElement>(".content h1");
      const content = document.querySelector<HTMLElement>(".content");
      const existing = document.querySelector<HTMLElement>("[data-civ-replenishment]");
      const title = heading?.textContent?.trim();
      const home = title === "Inicio" || title === "Resumen";

      if (home && content) {
        if (existing) {
          setMount((current) => current === existing ? current : existing);
          return;
        }
        const target = document.createElement("div");
        target.dataset.civReplenishment = "1";
        content.appendChild(target);
        setMount(target);
      } else if (existing) {
        existing.remove();
        setMount(null);
      }
    }

    const timer = window.setTimeout(syncMount, 0);
    const observer = new MutationObserver(syncMount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.querySelector<HTMLElement>("[data-civ-replenishment]")?.remove();
    };
  }, []);

  useEffect(() => {
    if (!mount) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [mount, load]);

  function navigate(label: string) {
    findNavigationButton(label)?.click();
  }

  function openInventory(item: ReplenishmentItem) {
    navigate("Inventario");
    window.setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('section[aria-label="Consulta rápida de inventario"] input');
      if (!input) return;
      setReactInput(input, item.sku);
      input.focus();
    }, 180);
  }

  if (!mount) return null;

  const items = data?.attention ?? [];
  const visibleItems = showAll ? items : items.slice(0, 8);

  return createPortal(
    <section className={styles.panel} aria-label="Reabastecimiento inteligente">
      <header className={styles.header}>
        <div>
          <p>REABASTECIMIENTO INTELIGENTE</p>
          <h2>¿Qué debería volver a pedir?</h2>
          <span>CIV combina existencia, mínimo, meta y ventas de los últimos 30 días para priorizar lo que necesita atención.</span>
        </div>
        <button type="button" className={styles.refresh} onClick={() => void load()} disabled={loading}>
          {loading ? "Actualizando…" : "Actualizar"}
        </button>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.summary}>
        <article>
          <strong className={data?.summary.outOfStock ? styles.danger : styles.ok}>{data?.summary.outOfStock ?? "—"}</strong>
          <span>Agotados</span>
          <small>Necesitan atención inmediata</small>
        </article>
        <article>
          <strong className={data?.summary.belowMinimum ? styles.warning : styles.ok}>{data?.summary.belowMinimum ?? "—"}</strong>
          <span>Debajo del mínimo</span>
          <small>Ya alcanzaron el punto de reposición</small>
        </article>
        <article>
          <strong className={data?.summary.approachingMinimum ? styles.notice : styles.ok}>{data?.summary.approachingMinimum ?? "—"}</strong>
          <span>Próximos al mínimo</span>
          <small>Podrían llegar al mínimo en 14 días</small>
        </article>
      </div>

      {!loading && data && items.length === 0 ? (
        <div className={styles.empty}>
          <strong>Inventario sin alertas de reabastecimiento</strong>
          <span>Por ahora ningún producto está agotado, debajo del mínimo ni proyectado a llegar al mínimo en los próximos 14 días.</span>
        </div>
      ) : null}

      {visibleItems.length > 0 && <div className={styles.list}>
        {visibleItems.map((item) => {
          const status = statusCopy(item.status);
          const unit = normalizeCommercialUnit(item.unit);
          const plural = (value: number) => unitLabel(unit, value !== 1);
          const days = item.daysToMinimum === null ? null : Math.max(0, Math.ceil(item.daysToMinimum));
          return <article className={styles.item} key={item.id}>
            <div className={styles.identity}>
              <code>{item.sku}</code>
              <strong>{item.name}</strong>
              <small>{item.category || "General"}</small>
            </div>

            <div className={styles.stock}>
              <span>Existencia</span>
              <b>{item.currentStock} {plural(item.currentStock)}</b>
              <small>Mínimo {item.minimumStock} · Meta {item.targetStock}</small>
            </div>

            <div className={`${styles.status} ${styles[item.status]}`}>
              <strong>{status.title}</strong>
              <span>{status.detail}</span>
              {days !== null && item.status === "proximo_minimo" && <small>≈ {days} día{days === 1 ? "" : "s"} para llegar al mínimo</small>}
            </div>

            <div className={styles.demand}>
              <span>Venta reciente</span>
              <b>{item.sold30} {plural(item.sold30)}</b>
              <small>Últimos 30 días · promedio {item.averageDailySales.toFixed(1)}/día</small>
            </div>

            <div className={styles.suggestion}>
              <span>Sugerencia</span>
              {item.suggestedOrder > 0 ? <>
                <b>Pedir {item.suggestedOrder} {plural(item.suggestedOrder)}</b>
                <small>Para volver a la meta de {item.targetStock}</small>
              </> : <>
                <b>Revisar meta</b>
                <small>La meta actual no requiere una cantidad adicional.</small>
              </>}
            </div>

            <div className={styles.actions}>
              <button type="button" onClick={() => openInventory(item)}>Ver producto</button>
              {data.canManageOrders && <button type="button" className={styles.primary} onClick={() => navigate("Pedidos")}>Ir a pedidos</button>}
            </div>
          </article>;
        })}
      </div>}

      {items.length > 8 && <button type="button" className={styles.more} onClick={() => setShowAll((value) => !value)}>
        {showAll ? "Mostrar menos" : `Ver los ${items.length} productos con atención`}
      </button>}

      <footer className={styles.footer}>
        <span><b>Cómo decide CIV:</b> agotado o en/bajo mínimo siempre se muestra. Si está arriba del mínimo, entra como “próximo” cuando el promedio de ventas de 30 días indica que podría llegar al mínimo en 14 días o menos.</span>
        {data?.canManageOrders && <button type="button" onClick={() => navigate("Pedidos")}>Abrir pedidos →</button>}
      </footer>
    </section>,
    mount,
  );
}
