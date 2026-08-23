"use client";

import { useEffect, useState } from "react";

type CancelResult = {
  ok?: boolean;
  folio?: string;
  message?: string;
  error?: string;
};

function buttonText(button: Element) {
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function movementIdFromRow(row: HTMLTableRowElement) {
  const raw = row.querySelector("td code")?.textContent?.trim() || "";
  const value = Number(raw.replace(/^#/, ""));
  return Number.isInteger(value) && value > 0 ? value : 0;
}

function isSaleRow(row: HTMLTableRowElement) {
  const cells = Array.from(row.querySelectorAll("td"));
  const movement = cells[2]?.textContent?.toLocaleLowerCase("es-MX") || "";
  const reference = cells[5]?.textContent?.trim() || "";
  return movement.includes("venta") || /^VTA-\d{8}-\d{6}$/i.test(reference);
}

export default function SaleCancellationExperience() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    async function capture(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button || buttonText(button) !== "Anular") return;
      const row = button.closest<HTMLTableRowElement>("tr");
      if (!row || !isSaleRow(row)) return;

      const movementId = movementIdFromRow(row);
      if (!movementId) return;

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      if (busy) return;

      const reason = window.prompt("Motivo obligatorio de anulación de la venta");
      if (!reason?.trim()) return;

      setBusy(true);
      setError("");
      setMessage("Anulando la venta y restaurando inventario…");
      try {
        const response = await fetch("/api/sales/cancel", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ movementId, reason: reason.trim() }),
        });
        const json = await response.json() as CancelResult;
        if (!response.ok) throw new Error(json.error || "No se pudo anular la venta.");
        setMessage(json.message || "Venta anulada e inventario restaurado.");
        window.dispatchEvent(new CustomEvent("civ:inventory-changed"));
        window.setTimeout(() => window.location.reload(), 250);
      } catch (reasonValue) {
        setMessage("");
        setError(reasonValue instanceof Error ? reasonValue.message : "No se pudo anular la venta.");
      } finally {
        setBusy(false);
      }
    }

    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, [busy]);

  if (!message && !error) return null;
  return <div className="update-banner">
    <span>
      <strong>{error ? "No se pudo anular la venta" : "Actualizando inventario"}</strong>
      <small>{error || message}</small>
    </span>
    {error && <button type="button" onClick={() => setError("")}>Cerrar</button>}
  </div>;
}
