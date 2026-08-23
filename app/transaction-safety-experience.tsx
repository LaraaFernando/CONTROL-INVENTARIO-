"use client";

import { useEffect } from "react";

function labelByText(modal: Element, text: string) {
  return Array.from(modal.querySelectorAll<HTMLLabelElement>("label"))
    .find((label) => label.querySelector("span")?.textContent?.trim() === text) ?? null;
}

function setRequired(label: HTMLLabelElement | null, required: boolean, title: string) {
  if (!label) return;
  const span = label.querySelector("span");
  if (span) span.textContent = title;
  const field = label.querySelector<HTMLInputElement | HTMLSelectElement>("input, select");
  if (field) field.required = required;
}

function configureSale(modal: HTMLElement) {
  const heading = modal.querySelector(".modal-head h2")?.textContent?.trim();
  if (heading !== "Venta con múltiples productos") return;

  setRequired(labelByText(modal, "Cliente relacionado") ?? labelByText(modal, "Cliente *"), true, "Cliente *");

  const referenceLabel = labelByText(modal, "Folio o referencia") ?? labelByText(modal, "Referencia adicional (opcional)");
  if (referenceLabel) {
    const span = referenceLabel.querySelector("span");
    if (span) span.textContent = "Referencia adicional (opcional)";
    const input = referenceLabel.querySelector<HTMLInputElement>("input");
    if (input) input.placeholder = "Pedido, cotización u otra referencia externa";

    if (!modal.querySelector("[data-civ-sale-folio-note]")) {
      const note = document.createElement("div");
      note.dataset.civSaleFolioNote = "1";
      note.className = "field-note wide";
      note.textContent = "El folio oficial de venta lo genera CIV automáticamente al confirmar y nunca se reutiliza.";
      referenceLabel.insertAdjacentElement("afterend", note);
    }
  }
}

function configureMovement(modal: HTMLElement) {
  const heading = modal.querySelector(".modal-head h2")?.textContent?.trim();
  if (heading !== "Registrar movimiento") return;

  const typeLabel = labelByText(modal, "Tipo *");
  const typeSelect = typeLabel?.querySelector<HTMLSelectElement>("select");
  if (!typeSelect) return;

  const apply = () => {
    const type = typeSelect.value;
    const needsClient = type === "devolucion_cliente";
    const needsReference = ["entrada_compra", "devolucion_cliente", "devolucion_proveedor"].includes(type);
    const needsReason = ["devolucion_cliente", "devolucion_proveedor", "ajuste_positivo", "ajuste_negativo"].includes(type);

    const clientLabel = labelByText(modal, "Cliente relacionado") ?? labelByText(modal, "Cliente *");
    setRequired(clientLabel, needsClient, needsClient ? "Cliente *" : "Cliente relacionado");

    const referenceLabel = labelByText(modal, "Folio o referencia")
      ?? labelByText(modal, "Folio de venta original *")
      ?? labelByText(modal, "Folio o referencia *");
    const referenceTitle = type === "devolucion_cliente" ? "Folio de venta original *" : needsReference ? "Folio o referencia *" : "Folio o referencia";
    setRequired(referenceLabel, needsReference, referenceTitle);

    const notesLabel = labelByText(modal, "Observaciones") ?? labelByText(modal, "Motivo / observaciones *");
    setRequired(notesLabel, needsReason, needsReason ? "Motivo / observaciones *" : "Observaciones");

    if (!modal.querySelector("[data-civ-movement-safety-note]")) {
      const note = document.createElement("div");
      note.dataset.civMovementSafetyNote = "1";
      note.className = "field-note wide";
      note.textContent = "CIV valida los datos obligatorios antes de modificar inventario. Las devoluciones de cliente deben coincidir con el cliente, producto y folio de la venta original.";
      const grid = modal.querySelector(".form-grid");
      grid?.appendChild(note);
    }
  };

  if (!typeSelect.dataset.civSafetyBound) {
    typeSelect.dataset.civSafetyBound = "1";
    typeSelect.addEventListener("change", apply);
  }
  apply();
}

export default function TransactionSafetyExperience() {
  useEffect(() => {
    const sync = () => {
      document.querySelectorAll<HTMLElement>(".modal").forEach((modal) => {
        configureSale(modal);
        configureMovement(modal);
      });
    };

    const timer = window.setTimeout(sync, 0);
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return null;
}
