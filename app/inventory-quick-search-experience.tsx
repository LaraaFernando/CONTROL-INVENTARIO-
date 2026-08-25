"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeCommercialUnit, unitLabel, validBoxFactor } from "./commercial-units";
import styles from "./inventory-quick-search-experience.module.css";

type Product = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  salePrice: number;
  currentStock: number;
  minimumStock: number;
  targetStock: number;
  boxFactor: number;
  location: string;
};

type Data = { products: Product[] };

function normalized(value: string) {
  return value.trim().toLocaleLowerCase("es-MX");
}

function codeNormalized(value: string) {
  return normalized(value).replace(/^#/, "");
}

function matches(product: Product, query: string) {
  const raw = normalized(query);
  if (!raw) return false;
  const codeQuery = codeNormalized(query);
  return codeNormalized(product.sku).includes(codeQuery)
    || normalized(product.name).includes(raw)
    || normalized(product.category || "").includes(raw);
}

export default function InventoryQuickSearchExperience() {
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const json = await response.json() as Data & { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo cargar el inventario.");
      setProducts(json.products ?? []);
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo cargar el inventario.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener("civ:inventory-updated", refresh);
    return () => window.removeEventListener("civ:inventory-updated", refresh);
  }, [load]);

  useEffect(() => {
    function syncMount() {
      const heading = document.querySelector<HTMLElement>(".content h1");
      const content = document.querySelector<HTMLElement>(".content");
      const current = document.querySelector<HTMLElement>("[data-civ-quick-inventory]");
      if (heading?.textContent?.trim() === "Inventario" && content) {
        if (current) {
          setMount((existing) => existing === current ? existing : current);
          return;
        }
        const target = document.createElement("div");
        target.dataset.civQuickInventory = "1";
        const header = content.querySelector(":scope > header");
        if (header?.nextSibling) content.insertBefore(target, header.nextSibling);
        else content.appendChild(target);
        setMount(target);
      } else if (current) {
        current.remove();
        setMount(null);
      }
    }

    const timer = window.setTimeout(syncMount, 0);
    const observer = new MutationObserver(syncMount);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.querySelector<HTMLElement>("[data-civ-quick-inventory]")?.remove();
    };
  }, []);

  const results = useMemo(
    () => query.trim() ? products.filter((product) => matches(product, query)).slice(0, 12) : [],
    [products, query],
  );

  if (!mount) return null;

  return createPortal(
    <section className={styles.panel} aria-label="Consulta rápida de inventario">
      <div className={styles.heading}>
        <div>
          <p>BÚSQUEDA RÁPIDA</p>
          <h2>Encuentra un producto en segundos</h2>
          <span>Busca por código, nombre o categoría. Puedes escribir el código con o sin #.</span>
        </div>
      </div>
      <label className={styles.search}>
        <span>Buscar producto</span>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ej. #45821, brocas, corredera..."
          autoComplete="off"
          inputMode="search"
        />
      </label>
      {error && <div className={styles.error}>{error}</div>}
      {!query.trim() ? (
        <div className={styles.hint}>Escribe al menos una parte del código o del nombre para consultar la existencia.</div>
      ) : results.length ? (
        <div className={styles.results}>
          {results.map((product) => {
            const unit = normalizeCommercialUnit(product.unit);
            const box = validBoxFactor(product.boxFactor);
            const target = Math.max(product.minimumStock, product.targetStock);
            const status = product.currentStock <= 0 ? "Agotado" : product.currentStock <= product.minimumStock ? "Poco stock" : "Disponible";
            return <article className={styles.result} key={product.id}>
              <div className={styles.main}>
                <code>{product.sku}</code>
                <strong>{product.name}</strong>
                <small>{product.category || "Sin categoría"}{product.location ? ` · Ubicación: ${product.location}` : ""}</small>
              </div>
              <div className={styles.stock}>
                <span>Existencia</span>
                <b>{product.currentStock} {unitLabel(unit, product.currentStock !== 1)}</b>
                <small>{status}</small>
              </div>
              <div className={styles.meta}>
                <span>Mínimo: <b>{product.minimumStock}</b></span>
                <span>Meta: <b>{target}</b></span>
                {box ? <span>Caja: <b>{box} {unitLabel(unit, box !== 1)}</b></span> : <span>Sin caja configurada</span>}
              </div>
            </article>;
          })}
        </div>
      ) : (
        <div className={styles.hint}>No encontré productos que coincidan con “{query}”.</div>
      )}
    </section>,
    mount,
  );
}
