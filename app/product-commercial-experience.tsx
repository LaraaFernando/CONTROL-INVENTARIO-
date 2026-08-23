"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { boxSummary, normalizeCommercialUnit, unitLabel, validBoxFactor } from "./commercial-units";
import styles from "./product-commercial-experience.module.css";

type Product = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  cost: number;
  salePrice: number;
  currentStock: number;
  minimumStock: number;
  targetStock: number;
  boxFactor: number;
  location: string;
};

type Data = {
  products: Product[];
  auth: { permissions: Record<string, boolean> };
};

function buttonText(button: Element) {
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function titleCase(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export default function ProductCommercialExperience() {
  const [data, setData] = useState<Data | null>(null);
  const [editing, setEditing] = useState<Product | null | undefined>(undefined);
  const [unit, setUnit] = useState("pieza");
  const [boxEnabled, setBoxEnabled] = useState(false);
  const [boxFactor, setBoxFactor] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const response = await fetch("/api/data", { cache: "no-store" });
    const json = await response.json() as Data & { error?: string };
    if (!response.ok) throw new Error(json.error || "No se pudo cargar el inventario.");
    setData(json);
    return json;
  }, []);

  const normalizeInventory = useCallback((source: Data | null) => {
    if (!source) return;
    const heading = document.querySelector(".content h1")?.textContent?.trim();
    if (heading !== "Inventario") return;
    const table = document.querySelector<HTMLTableElement>(".content .card.fill table");
    if (!table) return;
    const headers = Array.from(table.querySelectorAll("thead th"));
    const presentationIndex = headers.findIndex((cell) => cell.textContent?.trim() === "Presentaciones" || cell.textContent?.trim() === "Forma de venta");
    const stockIndex = headers.findIndex((cell) => cell.textContent?.trim() === "Existencia");
    const reorderIndex = headers.findIndex((cell) => cell.textContent?.trim() === "Reabastecimiento");
    if (presentationIndex >= 0) headers[presentationIndex].textContent = "Forma de venta";

    table.querySelectorAll("tbody tr").forEach((row) => {
      const code = row.querySelector("code")?.textContent?.trim();
      const product = source.products.find((item) => item.sku === code);
      if (!product) return;
      const cells = Array.from(row.querySelectorAll("td"));
      const baseUnit = normalizeCommercialUnit(product.unit);
      const plural = unitLabel(baseUnit, true);

      const productCell = cells[1];
      const baseSmall = productCell?.querySelector("small");
      if (baseSmall) baseSmall.textContent = `Unidad de inventario: ${unitLabel(baseUnit)}`;

      if (presentationIndex >= 0 && cells[presentationIndex]) {
        const strong = document.createElement("strong");
        strong.textContent = `${titleCase(unitLabel(baseUnit))} · 1 = 1 unidad de inventario`;
        const small = document.createElement("small");
        const factor = validBoxFactor(product.boxFactor);
        small.textContent = factor ? `Caja · 1 caja = ${factor} ${unitLabel(baseUnit, factor !== 1)}` : "Caja no configurada";
        cells[presentationIndex].replaceChildren(strong, small);
      }

      if (stockIndex >= 0 && cells[stockIndex]) {
        const amount = cells[stockIndex].querySelector("b");
        if (amount) amount.textContent = `${product.currentStock} ${unitLabel(baseUnit, product.currentStock !== 1)}`;
        const meta = cells[stockIndex].querySelector("small");
        const target = Math.max(product.minimumStock, product.targetStock);
        if (meta) meta.textContent = `Mín. ${product.minimumStock} ${plural} · Meta ${target} ${plural}`;
      }

      if (reorderIndex >= 0 && cells[reorderIndex]) {
        const suggested = Math.max(0, Math.max(product.minimumStock, product.targetStock) - product.currentStock);
        const strong = cells[reorderIndex].querySelector("strong");
        if (strong && suggested > 0) strong.textContent = `${suggested} ${unitLabel(baseUnit, suggested !== 1)}`;
      }
    });
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void load().then((json) => { if (active) normalizeInventory(json); }).catch(() => undefined);
    }, 0);
    const observer = new MutationObserver(() => normalizeInventory(data));
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { active = false; window.clearTimeout(timer); observer.disconnect(); };
  }, [load, normalizeInventory, data]);

  useEffect(() => {
    function capture(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button || button.closest(`.${styles.overlay}`)) return;
      const heading = document.querySelector(".content h1")?.textContent?.trim();
      if (heading !== "Inventario") return;
      const label = buttonText(button);
      const isNew = label.includes("Nuevo producto") || label.includes("Agregar producto") || label.includes("Nuevo registro");
      const isEdit = label === "Editar";
      if (!isNew && !isEdit) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      void (async () => {
        try {
          const current = await load();
          if (isEdit) {
            const code = button.closest("tr")?.querySelector("code")?.textContent?.trim();
            const product = current.products.find((item) => item.sku === code);
            if (!product) return;
            setEditing(product);
            const normalized = normalizeCommercialUnit(product.unit);
            setUnit(normalized);
            const factor = validBoxFactor(product.boxFactor);
            setBoxEnabled(Boolean(factor));
            setBoxFactor(String(factor || 0));
          } else {
            setEditing(null);
            setUnit("pieza");
            setBoxEnabled(false);
            setBoxFactor("0");
          }
          setError("");
        } catch (reason) {
          setError(reason instanceof Error ? reason.message : "No se pudo abrir el producto.");
        }
      })();
    }
    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, [load]);

  const basePlural = useMemo(() => unitLabel(unit, true), [unit]);
  const boxNumber = validBoxFactor(boxEnabled ? Number(boxFactor) : 0);

  function close() {
    if (busy) return;
    setEditing(undefined);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/product-commercial", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: editing ? "edit" : "add",
          id: editing?.id,
          sku: form.get("sku"),
          name: form.get("name"),
          category: form.get("category"),
          unit,
          cost: form.get("cost"),
          salePrice: form.get("salePrice"),
          initialStock: form.get("initialStock"),
          minimumStock: form.get("minimumStock"),
          targetStock: form.get("targetStock"),
          boxFactor: boxEnabled ? Number(boxFactor) : 0,
          location: form.get("location"),
        }),
      });
      const json = await response.json() as { error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo guardar el producto.");
      window.alert(editing ? "Producto actualizado." : "Producto registrado.");
      window.location.reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudo guardar el producto.");
    } finally {
      setBusy(false);
    }
  }

  if (editing === undefined || !data) return null;
  const canSeeCost = Boolean(data.auth.permissions["products.view_cost"]);
  const current = editing;

  return createPortal(
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={current ? "Modificar producto" : "Nuevo producto"}>
        <header className={styles.head}>
          <div>
            <p>UNIDAD COMERCIAL</p>
            <h2>{current ? "Modificar producto" : "Registrar producto"}</h2>
            <small>El inventario, costo, precio, mínimo y meta se controlan siempre en la unidad que realmente vendes.</small>
          </div>
          <button className={styles.close} type="button" onClick={close} disabled={busy}>×</button>
        </header>
        <form className={styles.form} onSubmit={submit}>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.grid}>
            <label className={styles.field}><span>Código *</span><input name="sku" defaultValue={current?.sku} required /></label>
            <label className={styles.field}><span>Producto *</span><input name="name" defaultValue={current?.name} required /></label>
            <label className={styles.field}><span>Categoría</span><input name="category" defaultValue={current?.category} /></label>
            <label className={styles.field}><span>Unidad de inventario y venta *</span><select value={unit} onChange={(event) => setUnit(event.target.value)}><option value="pieza">Pieza</option><option value="unidad">Unidad</option><option value="juego">Juego</option></select></label>

            <div className={styles.explain}>
              <strong>1 {unitLabel(unit)} = 1 unidad de inventario</strong>
              <span>{unit === "juego" ? "Si dentro del juego hay paquetes, brocas u otras piezas, ese contenido interno no multiplica el stock ni el precio. Si vendes 5 juegos, CIV descuenta 5 juegos." : `CIV contará y valorará este producto en ${basePlural}.`}</span>
            </div>

            {canSeeCost && <label className={styles.field}><span>Costo por {unitLabel(unit)}</span><input name="cost" type="number" min="0" step="0.01" defaultValue={current?.cost ?? 0} /></label>}
            <label className={styles.field}><span>Precio de venta por {unitLabel(unit)}</span><input name="salePrice" type="number" min="0" step="0.01" defaultValue={current?.salePrice ?? 0} required /></label>
            {!current && <label className={styles.field}><span>Existencia inicial ({basePlural})</span><input name="initialStock" type="number" min="0" step="1" defaultValue="0" /></label>}
            <label className={styles.field}><span>Stock mínimo ({basePlural})</span><input name="minimumStock" type="number" min="0" step="1" defaultValue={current?.minimumStock ?? 0} /></label>
            <label className={styles.field}><span>Stock objetivo ({basePlural})</span><input name="targetStock" type="number" min="0" step="1" defaultValue={current?.targetStock ?? 0} /></label>
            <label className={styles.field}><span>Ubicación</span><input name="location" defaultValue={current?.location} /></label>

            <label className={styles.boxToggle}>
              <input type="checkbox" checked={boxEnabled} onChange={(event) => { setBoxEnabled(event.target.checked); if (!event.target.checked) setBoxFactor("0"); else if (!validBoxFactor(Number(boxFactor))) setBoxFactor("2"); }} />
              <span><b>También se maneja por caja</b><small>Actívalo solo si quieres registrar o vender cajas completas.</small></span>
            </label>

            {boxEnabled && <label className={`${styles.field} ${styles.wide}`}><span>{titleCase(basePlural)} por caja *</span><input type="number" min="2" step="1" value={boxFactor} onChange={(event) => setBoxFactor(event.target.value)} required /></label>}

            <div className={styles.summary}>
              <b>Resumen</b>
              <small>1 {unitLabel(unit)} = 1 unidad de inventario.</small>
              <small>{boxEnabled && boxNumber ? boxSummary({ unit, boxFactor: boxNumber }) : "Este producto no tendrá presentación de caja."}</small>
              {unit === "juego" && <small>El contenido interno del juego es informativo para el producto, no una unidad de venta.</small>}
            </div>
          </div>
          <footer className={styles.actions}><button type="button" className={styles.cancel} onClick={close} disabled={busy}>Cancelar</button><button className={styles.save} disabled={busy}>{busy ? "Guardando…" : "Guardar producto"}</button></footer>
        </form>
      </section>
    </div>,
    document.body,
  );
}
