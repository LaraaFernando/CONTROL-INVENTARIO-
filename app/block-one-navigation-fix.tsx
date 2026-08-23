"use client";

import { useEffect } from "react";

const buttonDestinations: Record<string, string> = {
  Ventas: "Ventas",
  Inventario: "Inventario",
  "Recibir mercancía": "Pedidos",
  Movimientos: "Movimientos",
  Clientes: "Clientes",
  Proveedores: "Proveedores",
  Pedidos: "Pedidos",
  Auditoría: "Auditoría",
  "Facturación y pagos": "Facturación",
  "Notas de crédito": "Notas de crédito",
  "Corte diario": "Corte diario",
  "Usuarios y permisos": "Usuarios",
};

const alertDestinations: Record<string, string> = {
  "Con poco inventario": "Inventario",
  "Productos agotados": "Inventario",
  "Pedidos por recibir": "Pedidos",
};

function compactText(element: Element) {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function findOriginalNavigationButton(label: string) {
  const buttons = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sidebar nav > button, .mobile-nav > button"),
  );
  return buttons.find((button) => compactText(button).includes(label)) ?? null;
}

function destinationForButton(button: HTMLButtonElement) {
  const strongLabel = button.querySelector("strong")?.textContent?.trim();
  if (strongLabel && buttonDestinations[strongLabel]) return buttonDestinations[strongLabel];

  const spanLabels = Array.from(button.querySelectorAll("span"), (span) => span.textContent?.trim() || "");
  for (const spanLabel of spanLabels) {
    if (alertDestinations[spanLabel]) return alertDestinations[spanLabel];
  }

  if (button.closest(".sidebar nav") && !button.matches(".sidebar nav > button")) {
    const text = compactText(button);
    if (text.includes("Inicio")) return "Resumen";
    if (text.includes("Ventas")) return "Ventas";
    if (text.includes("Inventario")) return "Inventario";
    if (text.includes("Movimientos")) return "Movimientos";
  }

  return null;
}

export default function BlockOneNavigationFix() {
  useEffect(() => {
    function repairNavigation(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>("button");
      if (!button) return;

      // Los botones originales ya tienen su onClick de React. Solo reparamos
      // los accesos visuales añadidos por el Bloque 1.
      if (button.matches(".sidebar nav > button, .mobile-nav > button")) return;

      const destination = destinationForButton(button);
      if (!destination) return;

      const original = findOriginalNavigationButton(destination);
      if (original && original !== button) original.click();
    }

    document.addEventListener("click", repairNavigation, true);
    return () => document.removeEventListener("click", repairNavigation, true);
  }, []);

  return null;
}
