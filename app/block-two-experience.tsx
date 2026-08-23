"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./block-two-experience.module.css";

type Product = {
  id: number;
  sku: string;
  name: string;
  currentStock: number;
  minimumStock: number;
  setFactor: number;
  boxFactor: number;
};

type Data = {
  products: Product[];
  auth: {
    displayName: string;
    permissions: Record<string, boolean>;
  };
};

type CountRow = {
  id: number;
  productId: number;
  sku: string;
  productName: string;
  reason: string;
  performedBy: string;
  createdAt: string;
  previousStock: number;
  physicalStock: number;
  difference: number;
};

type Mode = "physical" | "sobrante" | "faltante" | "defectuoso";

const dateTime = (value: string) => new Intl.DateTimeFormat("es-MX", {
  dateStyle: "medium",
  timeStyle: "short",
}).format(new Date(value.replace(" ", "T") + "Z"));

function buttonText(button: Element) {
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function findBaseButton(label: string) {
  const candidates = Array.from(document.querySelectorAll<HTMLButtonElement>(
    ".mobile-nav button, .sidebar nav button",
  ));
  const normalized = label.toLocaleLowerCase("es-MX");
  return candidates.find((button) => buttonText(button).toLocaleLowerCase("es-MX").includes(normalized)) ?? null;
}

function factorFor(product: Product | undefined, presentation: string) {
  if (presentation === "juego") return Math.max(1, Number(product?.setFactor || 1));
  if (presentation === "caja") return Math.max(1, Number(product?.boxFactor || 1));
  return 1;
}

function modeCopy(mode: Mode) {
  if (mode === "physical") return { title: "Conteo físico", eyebrow: "COMPARAR INVENTARIO", help: "Compara lo que CIV dice contra lo que realmente encontraste." };
  if (mode === "sobrante") return { title: "Registrar sobrante", eyebrow: "MERCANCÍA DE MÁS", help: "Usa esta opción cuando encuentres mercancía que no estaba reflejada en CIV." };
  if (mode === "faltante") return { title: "Registrar faltante", eyebrow: "MERCANCÍA FALTANTE", help: "Usa esta opción cuando físicamente falten piezas respecto al inventario de CIV." };
  return { title: "Registrar producto dañado", eyebrow: "NO VENDIBLE", help: "Retira del inventario disponible la mercancía que ya no puede venderse." };
}

export default function BlockTwoExperience() {
  const [title, setTitle] = useState("");
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [counts, setCounts] = useState<CountRow[]>([]);
  const [mode, setMode] = useState<Mode | null>(null);
  const [productId, setProductId] = useState("");
  const [presentation, setPresentation] = useState("pieza");
  const [quantity, setQuantity] = useState("1");
  const [physicalStock, setPhysicalStock] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const syncInterface = useCallback(() => {
    const heading = document.querySelector<HTMLElement>(".content h1");
    const currentTitle = heading?.textContent?.trim() || "";
    setTitle((current) => current === currentTitle ? current : currentTitle);

    const content = document.querySelector<HTMLElement>(".content");
    let target = document.querySelector<HTMLElement>("[data-civ-block-two-mount]");
    if (currentTitle === "Movimientos" && content) {
      if (!target) {
        target = document.createElement("div");
        target.dataset.civBlockTwoMount = "1";
        const firstCard = content.querySelector<HTMLElement>(".card.fill");
        if (firstCard) content.insertBefore(target, firstCard);
        else content.appendChild(target);
      }
      setMount((current) => current === target ? current : target);
    } else if (target) {
      target.remove();
      setMount(null);
    }

    document.querySelectorAll<HTMLElement>("label span").forEach((label) => {
      const text = label.textContent?.trim();
      if (text === "Piezas por juego") label.textContent = "Contenido del juego (piezas)";
      if (text === "Piezas por caja") label.textContent = "Contenido de la caja (piezas)";
    });

    const boxLabel = Array.from(document.querySelectorAll<HTMLLabelElement>("label")).find((label) =>
      label.querySelector("span")?.textContent?.trim() === "Contenido de la caja (piezas)",
    );
    if (boxLabel && !document.querySelector("[data-civ-presentation-help]")) {
      const note = document.createElement("div");
      note.dataset.civPresentationHelp = "1";
      note.className = "field-note wide";
      note.textContent = "Cada producto guarda su propio contenido. Pieza y unidad equivalen a 1; define aquí cuántas piezas contiene cada juego y cada caja.";
      boxLabel.insertAdjacentElement("afterend", note);
    }

    document.querySelectorAll<HTMLElement>(".pill").forEach((pill) => {
      const text = pill.textContent?.trim();
      if (text === "conteo_fisico") pill.textContent = "Conteo físico";
      if (text === "sobrante") pill.textContent = "Sobrante";
      if (text === "faltante") pill.textContent = "Faltante";
    });

    if (sessionStorage.getItem("civ-return-to-movements") === "1") {
      const movementButton = findBaseButton("Movimientos");
      if (movementButton) {
        sessionStorage.removeItem("civ-return-to-movements");
        movementButton.click();
      }
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => syncInterface(), 0);
    const observer = new MutationObserver(() => syncInterface());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.querySelector<HTMLElement>("[data-civ-block-two-mount]")?.remove();
    };
  }, [syncInterface]);

  const load = useCallback(async () => {
    try {
      const dataResponse = await fetch("/api/data", { cache: "no-store" });
      const dataJson = await dataResponse.json() as Data & { error?: string };
      if (!dataResponse.ok) throw new Error(dataJson.error || "No se pudo cargar el inventario.");
      setData(dataJson);

      if (dataJson.auth.permissions["movements.adjust"] || dataJson.auth.permissions["audit.view"]) {
        const countResponse = await fetch("/api/inventory-control", { cache: "no-store" });
        const countJson = await countResponse.json() as { counts?: CountRow[]; error?: string };
        if (countResponse.ok) setCounts(countJson.counts ?? []);
      }
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo cargar el control físico.");
    }
  }, []);

  useEffect(() => {
    if (title !== "Movimientos") return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [title, load]);

  const permissions = data?.auth.permissions ?? {};
  const selected = useMemo(
    () => data?.products.find((product) => String(product.id) === productId),
    [data, productId],
  );
  const factor = factorFor(selected, presentation);
  const presentationCount = Math.max(0, Math.floor(Number(quantity) || 0));
  const baseQuantity = presentationCount * factor;
  const countValue = Math.max(0, Math.floor(Number(physicalStock) || 0));
  const difference = selected && physicalStock !== "" ? countValue - selected.currentStock : 0;

  function open(next: Mode) {
    setMode(next);
    setProductId(String(data?.products[0]?.id ?? ""));
    setPresentation("pieza");
    setQuantity("1");
    setPhysicalStock(data?.products[0] ? String(data.products[0].currentStock) : "");
    setReason("");
    setError("");
  }

  function close() {
    if (busy) return;
    setMode(null);
    setError("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mode) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "physical" ? {
          action: "physical_count",
          productId: Number(productId),
          physicalStock: Number(physicalStock),
          reason,
        } : {
          action: "stock_incident",
          incident: mode,
          productId: Number(productId),
          presentation,
          quantity: Number(quantity),
          reason,
        }),
      });
      const json = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(json.error || "No se pudo registrar el movimiento.");
      setNotice(json.message || "Movimiento registrado correctamente.");
      setMode(null);
      await load();
      window.setTimeout(() => {
        sessionStorage.setItem("civ-return-to-movements", "1");
        window.location.reload();
      }, 900);
    } catch (reasonValue) {
      setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo registrar el movimiento.");
    } finally {
      setBusy(false);
    }
  }

  if (!mount || title !== "Movimientos" || !data) return null;

  const panel = <div className={styles.panel}>
    {notice && <div className={styles.notice}>{notice}</div>}
    <section className={styles.intro}>
      <p>BLOQUE 2A · CONTROL FÍSICO</p>
      <h2>¿Qué pasó con la mercancía?</h2>
      <span>Registra diferencias con palabras sencillas. Todo cambio exige un motivo y queda ligado al usuario, fecha y hora en Auditoría.</span>
    </section>

    <section className={styles.actions}>
      {permissions["movements.adjust"] && <button className={styles.action} onClick={() => open("physical")}><b>✓</b><strong>Conteo físico</strong><small>Comparar CIV contra lo que realmente hay</small></button>}
      {permissions["movements.adjust"] && <button className={styles.action} onClick={() => open("sobrante")}><b>＋</b><strong>Sobrante</strong><small>Encontré mercancía de más</small></button>}
      {permissions["movements.adjust"] && <button className={styles.action} onClick={() => open("faltante")}><b>−</b><strong>Faltante</strong><small>Falta mercancía en el almacén</small></button>}
      {permissions["movements.defective"] && <button className={styles.action} onClick={() => open("defectuoso")}><b>!</b><strong>Dañado</strong><small>Producto que ya no puede venderse</small></button>}
    </section>

    {(permissions["movements.adjust"] || permissions["audit.view"]) && <section className={styles.history}>
      <div className={styles.historyHead}><h3>Conteos recientes</h3><p>Comparación entre la existencia de CIV y el conteo físico.</p></div>
      {counts.length ? <div className={styles.counts}>{counts.slice(0, 8).map((count) => <div className={styles.count} key={count.id}>
        <div><strong>{count.productName}</strong><small>Código {count.sku} · {dateTime(count.createdAt)}</small></div>
        <div><small>CIV</small><span className={styles.number}>{count.previousStock}</span></div>
        <div><small>Físico</small><span className={styles.number}>{count.physicalStock}</span></div>
        <div><small>Diferencia</small><span className={`${styles.number} ${count.difference > 0 ? styles.positive : count.difference < 0 ? styles.negative : styles.neutral}`}>{count.difference > 0 ? "+" : ""}{count.difference}</span></div>
        <div><strong>{count.performedBy}</strong><small>{count.reason}</small></div>
      </div>)}</div> : <div className={styles.empty}>Todavía no hay conteos físicos registrados.</div>}
    </section>}
  </div>;

  const modalCopy = mode ? modeCopy(mode) : null;
  return <>
    {createPortal(panel, mount)}
    {mode && modalCopy && <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
      <section className={styles.modal} role="dialog" aria-modal="true" aria-label={modalCopy.title}>
        <header className={styles.modalHead}><div><p>{modalCopy.eyebrow}</p><h3>{modalCopy.title}</h3><small>{modalCopy.help}</small></div><button className={styles.close} onClick={close} disabled={busy} aria-label="Cerrar">×</button></header>
        <form className={styles.form} onSubmit={submit}>
          {error && <div className={styles.error}>{error}</div>}
          <div className={styles.grid}>
            <label className={`${styles.field} ${styles.wide}`}><span>Producto *</span><select value={productId} onChange={(event) => { const value = event.target.value; setProductId(value); const product = data.products.find((row) => String(row.id) === value); if (mode === "physical" && product) setPhysicalStock(String(product.currentStock)); }} required>{data.products.map((product) => <option key={product.id} value={product.id}>{product.sku} · {product.name} · existencia {product.currentStock}</option>)}</select></label>

            {mode === "physical" ? <label className={styles.field}><span>Conteo físico *</span><input type="number" inputMode="numeric" min="0" step="1" value={physicalStock} onChange={(event) => setPhysicalStock(event.target.value)} required /></label> : <>
              <label className={styles.field}><span>Presentación *</span><select value={presentation} onChange={(event) => setPresentation(event.target.value)}><option value="pieza">Pieza · 1</option><option value="unidad">Unidad · 1</option><option value="juego">Juego · {selected?.setFactor || 1} piezas</option><option value="caja">Caja · {selected?.boxFactor || 1} piezas</option></select></label>
              <label className={styles.field}><span>Cantidad de presentaciones *</span><input type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} required /></label>
            </>}

            <label className={`${styles.field} ${styles.wide}`}><span>Motivo *</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder={mode === "physical" ? "Ej. Conteo semanal del almacén" : mode === "sobrante" ? "Ej. Mercancía encontrada en otra caja" : mode === "faltante" ? "Ej. Diferencia detectada durante revisión" : "Ej. Producto golpeado o roto"} required /></label>
          </div>

          <div className={styles.summary}>
            {mode === "physical" ? <>
              <div className={styles.summaryRow}><span>Existencia en CIV</span><strong>{selected?.currentStock ?? 0}</strong></div>
              <div className={styles.summaryRow}><span>Conteo físico</span><strong>{physicalStock === "" ? "—" : countValue}</strong></div>
              <div className={styles.summaryRow}><span>Diferencia</span><strong className={difference > 0 ? styles.positive : difference < 0 ? styles.negative : styles.neutral}>{physicalStock === "" ? "—" : `${difference > 0 ? "+" : ""}${difference}`}</strong></div>
            </> : <>
              <div className={styles.summaryRow}><span>Contenido de la presentación</span><strong>{factor} pieza(s)</strong></div>
              <div className={styles.summaryRow}><span>Unidades base afectadas</span><strong>{baseQuantity}</strong></div>
              <div className={styles.summaryRow}><span>Existencia actual</span><strong>{selected?.currentStock ?? 0}</strong></div>
              <div className={styles.summaryRow}><span>Existencia después</span><strong>{selected ? selected.currentStock + (mode === "sobrante" ? baseQuantity : -baseQuantity) : 0}</strong></div>
            </>}
            <div className={styles.reasonNote}>El motivo, usuario, fecha y hora quedarán guardados en Auditoría. La existencia nunca se modifica silenciosamente.</div>
          </div>

          <div className={styles.modalActions}><button type="button" className={styles.cancel} onClick={close} disabled={busy}>Cancelar</button><button className={styles.confirm} disabled={busy || !productId || !reason.trim()}>{busy ? "Guardando…" : "Confirmar"}</button></div>
        </form>
      </section>
    </div>}
  </>;
}
