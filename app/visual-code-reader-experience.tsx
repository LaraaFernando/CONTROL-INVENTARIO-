"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./visual-code-reader-experience.module.css";

type Product = {
  id: number;
  sku: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
};

type Data = { products: Product[]; error?: string };
type Context = "inventory" | "sale";
type Match = { product: Product; exact: boolean };
type OcrLog = { status?: string; progress?: number };
type OcrResult = { data: { text: string } };
type OcrWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<void>;
  recognize: (image: string | File | Blob) => Promise<OcrResult>;
  terminate: () => Promise<void>;
};
type TesseractApi = {
  createWorker: (language?: string, oem?: number, options?: { logger?: (message: OcrLog) => void }) => Promise<OcrWorker>;
};

declare global {
  interface Window {
    Tesseract?: TesseractApi;
  }
}

const TESSERACT_URL = "https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js";
let tesseractPromise: Promise<TesseractApi> | null = null;

function normalizeCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function numericOcr(value: string) {
  return value
    .toUpperCase()
    .replace(/O|Q/g, "0")
    .replace(/I|L|\|/g, "1")
    .replace(/Z/g, "2")
    .replace(/S/g, "5")
    .replace(/B/g, "8")
    .replace(/[^0-9]/g, "");
}

function levenshtein(left: string, right: string) {
  const rows = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = rows[0];
    rows[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const previous = rows[j];
      rows[j] = Math.min(
        rows[j] + 1,
        rows[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = previous;
    }
  }
  return rows[right.length];
}

function extractCandidates(text: string) {
  const direct = text.toUpperCase().match(/[#A-Z0-9][#A-Z0-9\-_.]{2,}/g) ?? [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const values = new Set<string>();

  for (const value of [...direct, ...lines]) {
    const normalized = normalizeCode(value);
    if (normalized.length >= 3) values.add(normalized);
    const numeric = numericOcr(value);
    if (numeric.length >= 3) values.add(numeric);
  }

  return Array.from(values);
}

function findMatches(products: Product[], text: string) {
  const candidates = extractCandidates(text);
  const exact = products
    .filter((product) => candidates.includes(normalizeCode(product.sku)))
    .map((product) => ({ product, exact: true } satisfies Match));

  if (exact.length) return exact.slice(0, 6);

  return products
    .map((product) => {
      const code = normalizeCode(product.sku);
      const distance = candidates
        .filter((candidate) => candidate.length === code.length)
        .reduce((best, candidate) => Math.min(best, levenshtein(code, candidate)), Number.POSITIVE_INFINITY);
      return { product, distance };
    })
    .filter((item) => item.distance <= 1)
    .sort((left, right) => left.distance - right.distance)
    .slice(0, 5)
    .map(({ product }) => ({ product, exact: false } satisfies Match));
}

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  if (tesseractPromise) return tesseractPromise;

  tesseractPromise = new Promise<TesseractApi>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${TESSERACT_URL}"]`);
    const finish = () => {
      if (window.Tesseract) resolve(window.Tesseract);
      else reject(new Error("No se pudo iniciar el reconocimiento de texto."));
    };

    if (existing) {
      if (window.Tesseract) {
        resolve(window.Tesseract);
        return;
      }
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("No se pudo cargar el lector visual.")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.src = TESSERACT_URL;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      reject(new Error("No se pudo cargar el lector visual."));
    }, { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    tesseractPromise = null;
    throw error;
  });

  return tesseractPromise;
}

async function prepareImage(file: File) {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("No se pudo abrir la foto."));
    });

    const maxWidth = 1800;
    const maxHeight = 1400;
    const scale = Math.min(1, maxWidth / image.naturalWidth, maxHeight / image.naturalHeight);
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("No se pudo preparar la imagen.");

    context.drawImage(image, 0, 0, width, height);
    const imageData = context.getImageData(0, 0, width, height);
    const pixels = imageData.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = 0.299 * pixels[index] + 0.587 * pixels[index + 1] + 0.114 * pixels[index + 2];
      const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.45 + 128));
      pixels[index] = contrasted;
      pixels[index + 1] = contrasted;
      pixels[index + 2] = contrasted;
    }
    context.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(source);
  }
}

function setReactInput(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function inventoryInput() {
  return document.querySelector<HTMLInputElement>('section[aria-label="Consulta rápida de inventario"] input');
}

function saleInput() {
  return Array.from(document.querySelectorAll<HTMLInputElement>(".modal.operations-modal input"))
    .find((input) => input.placeholder.includes("#45821")) ?? null;
}

function productButtonInSale(input: HTMLInputElement, sku: string) {
  const card = input.closest(".card");
  if (!card) return null;
  return Array.from(card.querySelectorAll<HTMLButtonElement>("button")).find((button) => {
    const code = button.querySelector("code")?.textContent?.trim() ?? "";
    return normalizeCode(code) === normalizeCode(sku) && !button.disabled;
  }) ?? null;
}

export default function VisualCodeReaderExperience() {
  const [inventoryMount, setInventoryMount] = useState<HTMLElement | null>(null);
  const [saleMount, setSaleMount] = useState<HTMLElement | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState<Context | null>(null);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [reading, setReading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [ocrText, setOcrText] = useState("");
  const [manualCode, setManualCode] = useState("");
  const [matches, setMatches] = useState<Match[]>([]);

  const loadProducts = useCallback(async () => {
    if (products.length || loadingProducts) return;
    setLoadingProducts(true);
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const json = await response.json() as Data;
      if (!response.ok) throw new Error(json.error || "No se pudieron cargar los productos.");
      setProducts(json.products ?? []);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "No se pudieron cargar los productos.");
    } finally {
      setLoadingProducts(false);
    }
  }, [loadingProducts, products.length]);

  useEffect(() => {
    function ensureMount(selector: string, attribute: string) {
      const host = document.querySelector<HTMLElement>(selector);
      if (!host) return null;
      const existing = host.querySelector<HTMLElement>(`[${attribute}]`);
      if (existing) return existing;
      const target = document.createElement("div");
      target.setAttribute(attribute, "1");
      host.appendChild(target);
      return target;
    }

    function sync() {
      const inventory = ensureMount('section[aria-label="Consulta rápida de inventario"]', "data-civ-camera-inventory");
      setInventoryMount((current) => current === inventory ? current : inventory);

      const input = saleInput();
      const saleCard = input?.closest<HTMLElement>(".card") ?? null;
      let sale: HTMLElement | null = null;
      if (saleCard) {
        sale = saleCard.querySelector<HTMLElement>("[data-civ-camera-sale]");
        if (!sale) {
          sale = document.createElement("div");
          sale.dataset.civCameraSale = "1";
          input?.insertAdjacentElement("afterend", sale);
        }
      }
      setSaleMount((current) => current === sale ? current : sale);
    }

    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
      document.querySelectorAll("[data-civ-camera-inventory], [data-civ-camera-sale]").forEach((node) => node.remove());
    };
  }, []);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const manualMatches = useMemo(() => {
    const code = normalizeCode(manualCode);
    if (!code) return [];
    return products
      .filter((product) => normalizeCode(product.sku).includes(code))
      .slice(0, 6)
      .map((product) => ({ product, exact: normalizeCode(product.sku) === code } satisfies Match));
  }, [manualCode, products]);

  function begin(context: Context) {
    setOpen(context);
    setError("");
    setStatus("");
    setProgress(0);
    setOcrText("");
    setManualCode("");
    setMatches([]);
    if (preview) URL.revokeObjectURL(preview);
    setPreview("");
    void loadProducts();
  }

  function close() {
    if (reading) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview("");
    setOpen(null);
  }

  async function readFile(file: File) {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(file));
    setReading(true);
    setProgress(0);
    setStatus("Preparando la foto…");
    setError("");
    setMatches([]);
    setOcrText("");

    try {
      let availableProducts = products;
      if (!availableProducts.length) {
        const response = await fetch("/api/data", { cache: "no-store" });
        const json = await response.json() as Data;
        if (!response.ok) throw new Error(json.error || "No se pudieron cargar los productos.");
        availableProducts = json.products ?? [];
        setProducts(availableProducts);
      }

      const prepared = await prepareImage(file);
      const tesseract = await loadTesseract();
      setStatus("Leyendo el código impreso…");
      const worker = await tesseract.createWorker("eng", 1, {
        logger: (message) => {
          if (typeof message.progress === "number") setProgress(Math.round(message.progress * 100));
          if (message.status) setStatus(message.status === "recognizing text" ? "Reconociendo números…" : "Preparando reconocimiento…");
        },
      });

      try {
        await worker.setParameters({
          tessedit_char_whitelist: "#0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_",
          preserve_interword_spaces: "1",
          tessedit_pageseg_mode: "6",
        });
        const result = await worker.recognize(prepared);
        const text = result.data.text.trim();
        setOcrText(text);
        const productMatches = findMatches(availableProducts, text);
        setMatches(productMatches);
        if (!productMatches.length) {
          setError("No encontré una coincidencia segura. Puedes corregir o escribir el código abajo.");
        } else {
          setStatus(productMatches.some((item) => item.exact) ? "Código reconocido." : "Encontré una posible coincidencia. Confírmala antes de continuar.");
        }
      } finally {
        await worker.terminate();
      }
    } catch (reason) {
      setError(reason instanceof Error ? `${reason.message} Puedes escribir el código manualmente.` : "No se pudo leer la foto. Puedes escribir el código manualmente.");
    } finally {
      setReading(false);
      setProgress(100);
    }
  }

  function choose(product: Product) {
    if (open === "inventory") {
      const input = inventoryInput();
      if (input) {
        setReactInput(input, product.sku);
        input.focus();
      }
      close();
      return;
    }

    if (open === "sale") {
      const input = saleInput();
      if (!input) return;
      setReactInput(input, product.sku);
      window.setTimeout(() => {
        productButtonInSale(input, product.sku)?.click();
      }, 80);
      close();
    }
  }

  const shownMatches = manualCode.trim() ? manualMatches : matches;

  return <>
    {inventoryMount && createPortal(
      <button type="button" className={styles.trigger} onClick={() => begin("inventory")}>📷 Leer código de caja</button>,
      inventoryMount,
    )}
    {saleMount && createPortal(
      <button type="button" className={styles.trigger} onClick={() => begin("sale")}>📷 Leer código de caja</button>,
      saleMount,
    )}
    {open && createPortal(
      <div className={styles.backdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
        <section className={styles.modal} role="dialog" aria-modal="true" aria-label="Reconocer código impreso">
          <header className={styles.header}>
            <div>
              <p>LECTOR VISUAL</p>
              <h2>Reconocer código de la caja</h2>
              <span>Acerca la cámara al número impreso, por ejemplo #9173739193.</span>
            </div>
            <button type="button" onClick={close} disabled={reading} aria-label="Cerrar">×</button>
          </header>

          <div className={styles.body}>
            <div className={styles.privacy}>🔒 La foto se procesa en tu dispositivo. CIV no la guarda ni la sube a su base de datos.</div>

            <label className={styles.cameraButton}>
              <span>{reading ? "Leyendo…" : preview ? "📷 Tomar otra foto" : "📷 Tomar foto del código"}</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                disabled={reading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.currentTarget.value = "";
                  if (file) void readFile(file);
                }}
              />
            </label>

            {preview && <div className={styles.preview}><img src={preview} alt="Foto del código a reconocer" /></div>}

            {(reading || status) && <div className={styles.progressBox}>
              <div><strong>{status || "Procesando…"}</strong><span>{Math.min(100, progress)}%</span></div>
              <progress max="100" value={progress} />
              {reading && <small>La primera lectura puede tardar unos segundos mientras se prepara el reconocimiento local.</small>}
            </div>}

            {ocrText && <details className={styles.detected}><summary>Texto que detectó la cámara</summary><code>{ocrText}</code></details>}
            {error && <div className={styles.error}>{error}</div>}

            <label className={styles.manual}>
              <span>Corregir o escribir código</span>
              <input
                value={manualCode}
                onChange={(event) => setManualCode(event.target.value)}
                placeholder="#9173739193"
                inputMode="text"
                autoComplete="off"
              />
              <small>Úsalo si la impresión está borrosa o la cámara confundió algún dígito.</small>
            </label>

            {loadingProducts && <div className={styles.info}>Cargando productos registrados…</div>}

            {shownMatches.length > 0 && <div className={styles.matches}>
              <strong>{manualCode.trim() ? "Coincidencias" : "Producto reconocido"}</strong>
              {shownMatches.map(({ product, exact }) => {
                const blocked = open === "sale" && product.currentStock <= 0;
                return <button key={product.id} type="button" disabled={blocked} onClick={() => choose(product)}>
                  <span>
                    <code>{product.sku}</code>
                    <b>{product.name}</b>
                    <small>{product.category || "Sin categoría"} · Stock {product.currentStock}</small>
                  </span>
                  <span className={styles.pick}>{blocked ? "Agotado" : open === "sale" ? "Agregar a venta" : "Ver inventario"}</span>
                  {!exact && <em>Revisar coincidencia</em>}
                </button>;
              })}
            </div>}
          </div>
        </section>
      </div>,
      document.body,
    )}
  </>;
}
