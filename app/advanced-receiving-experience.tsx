"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./advanced-receiving-experience.module.css";

type Order = {
  id: number;
  folio: string;
  supplierName: string;
  canceled: number;
  receivedStatus: string;
};

type OrderItem = {
  id: number;
  orderId: number;
  productId: number;
  sku: string;
  productName: string;
  presentation: string;
  presentationFactor: number;
  orderedQuantity: number;
  receivedQuantity: number;
};

type OperationsData = {
  orders: Order[];
  orderItems: OrderItem[];
};

type ReceiptLine = {
  itemId: number;
  received: string;
  damaged: string;
};

function integer(value: string) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function presentationLabel(item: OrderItem) {
  const factor = Math.max(1, Number(item.presentationFactor || 1));
  const count = item.orderedQuantity / factor;
  const label = ({
    pieza: "pieza",
    unidad: "unidad",
    ciento: "ciento",
    juego: "juego",
    caja: "caja",
  } as Record<string, string>)[item.presentation] ?? item.presentation;
  const plural = count === 1 ? label : `${label}s`;
  return factor === 1
    ? `${item.orderedQuantity} ${plural}`
    : `${count} ${plural} × ${factor} = ${item.orderedQuantity} piezas`;
}

export default function AdvancedReceivingExperience() {
  const [data, setData] = useState<OperationsData | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [lines, setLines] = useState<ReceiptLine[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadOrder = useCallback(async (folio: string) => {
    setError("");
    try {
      const response = await fetch("/api/operations", { cache: "no-store" });
      const json = (await response.json()) as OperationsData & { error?: string };
      if (!response.ok) {
        setError(json.error || "No se pudo cargar el pedido.");
        return;
      }
      const selected = (json.orders ?? []).find(
        (candidate) => candidate.folio === folio && !candidate.canceled,
      );
      if (!selected) {
        setError("No se encontró el pedido seleccionado.");
        return;
      }
      const items = (json.orderItems ?? []).filter((item) => item.orderId === selected.id);
      setData(json);
      setOrder(selected);
      setLines(items.map((item) => ({
        itemId: item.id,
        received: String(Math.max(item.orderedQuantity - item.receivedQuantity, 0)),
        damaged: "0",
      })));
      setReason("");
      setNotes("");
    } catch {
      setError("No se pudo abrir la recepción. Intenta de nuevo.");
    }
  }, []);

  useEffect(() => {
    function capture(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button || button.closest(`.${styles.overlay}`)) return;
      const label = (button.textContent || "").replace(/\s+/g, " ").trim();
      if (label !== "Recibir") return;
      const row = button.closest("tr");
      const folio = row?.querySelector("code")?.textContent?.trim();
      if (!folio) return;
      event.preventDefault();
      event.stopPropagation();
      void loadOrder(folio);
    }

    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, [loadOrder]);

  const items = useMemo(
    () => order && data ? data.orderItems.filter((item) => item.orderId === order.id) : [],
    [data, order],
  );

  const preview = useMemo(() => items.map((item) => {
    const line = lines.find((candidate) => candidate.itemId === item.id);
    const pending = Math.max(item.orderedQuantity - item.receivedQuantity, 0);
    const received = integer(line?.received ?? "0");
    const damaged = Math.min(integer(line?.damaged ?? "0"), received);
    const good = received - damaged;
    const excess = Math.max(good - pending, 0);
    const shortage = Math.max(pending - good, 0);
    return { item, pending, received, damaged, good, excess, shortage };
  }), [items, lines]);

  const hasDifference = preview.some(
    (entry) => entry.received !== entry.pending || entry.damaged > 0,
  );

  function close() {
    if (saving) return;
    setOrder(null);
    setData(null);
    setLines([]);
    setReason("");
    setNotes("");
    setError("");
  }

  function updateLine(itemId: number, field: "received" | "damaged", value: string) {
    setLines((current) => current.map((line) =>
      line.itemId === itemId ? { ...line, [field]: value } : line,
    ));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!order || saving) return;
    setError("");
    if (hasDifference && !reason.trim()) {
      setError("Indica el motivo de la diferencia antes de confirmar.");
      return;
    }
    for (const entry of preview) {
      if (entry.damaged > entry.received) {
        setError("La cantidad dañada no puede superar lo recibido.");
        return;
      }
    }

    setSaving(true);
    try {
      const response = await fetch("/api/receiving", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orderId: order.id,
          reason,
          notes,
          items: lines.map((line) => ({
            itemId: line.itemId,
            received: integer(line.received),
            damaged: integer(line.damaged),
          })),
        }),
      });
      const json = await response.json() as { error?: string; receivedStatus?: string };
      if (!response.ok) {
        setError(json.error || "No se pudo registrar la recepción.");
        return;
      }
      window.alert(
        json.receivedStatus === "completo"
          ? "Recepción registrada. El pedido quedó completo."
          : "Recepción registrada. El pedido conserva mercancía pendiente.",
      );
      window.location.reload();
    } catch {
      setError("No se pudo registrar la recepción. Intenta de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  if (!order) return error ? <div className={styles.floatingError}>{error}</div> : null;

  return (
    <div className={styles.overlay} onMouseDown={(event) => {
      if (event.target === event.currentTarget) close();
    }}>
      <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={`Recibir pedido ${order.folio}`}>
        <header className={styles.header}>
          <div>
            <span>RECEPCIÓN DE MERCANCÍA</span>
            <h2>Pedido {order.folio}</h2>
            <p>{order.supplierName}</p>
          </div>
          <button type="button" onClick={close} aria-label="Cerrar">×</button>
        </header>

        <div className={styles.explanation}>
          <strong>Cuenta lo que llegó físicamente.</strong>
          <span>CIV separará automáticamente lo bueno, lo faltante, lo sobrante y lo dañado.</span>
        </div>

        <form onSubmit={submit}>
          <div className={styles.lines}>
            {preview.map(({ item, pending, received, damaged, good, excess, shortage }) => (
              <article className={styles.line} key={item.id}>
                <div className={styles.product}>
                  <div>
                    <b>{item.sku}</b>
                    <strong>{item.productName}</strong>
                    <small>{presentationLabel(item)}</small>
                  </div>
                  <div className={styles.pending}>
                    <span>Pendiente</span>
                    <b>{pending}</b>
                    <small>piezas</small>
                  </div>
                </div>

                <div className={styles.inputs}>
                  <label>
                    <span>Recibido físicamente</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={lines.find((line) => line.itemId === item.id)?.received ?? "0"}
                      onChange={(event) => updateLine(item.id, "received", event.target.value)}
                    />
                  </label>
                  <label>
                    <span>Dañado</span>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      inputMode="numeric"
                      value={lines.find((line) => line.itemId === item.id)?.damaged ?? "0"}
                      onChange={(event) => updateLine(item.id, "damaged", event.target.value)}
                    />
                  </label>
                </div>

                <div className={styles.result}>
                  <span><b>{good}</b> buenas para inventario</span>
                  {shortage > 0 && <span className={styles.shortage}>Faltan {shortage}</span>}
                  {excess > 0 && <span className={styles.excess}>Sobran +{excess}</span>}
                  {damaged > 0 && <span className={styles.damaged}>{damaged} dañadas</span>}
                  {!shortage && !excess && !damaged && received === pending && (
                    <span className={styles.exact}>Cantidad correcta</span>
                  )}
                </div>
              </article>
            ))}
          </div>

          {hasDifference && (
            <label className={styles.reason}>
              <span>Motivo de la diferencia *</span>
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej. El proveedor envió 5 piezas de más / llegaron 3 dañadas / faltaron 8 piezas"
                required
              />
              <small>Este motivo quedará guardado en Auditoría con usuario, fecha y hora.</small>
            </label>
          )}

          <label className={styles.reason}>
            <span>Notas adicionales</span>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Opcional"
            />
          </label>

          {error && <div className={styles.error}>{error}</div>}

          <footer className={styles.actions}>
            <button type="button" onClick={close} disabled={saving}>Cancelar</button>
            <button type="submit" className={styles.primary} disabled={saving}>
              {saving ? "Guardando…" : "Confirmar recepción"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
