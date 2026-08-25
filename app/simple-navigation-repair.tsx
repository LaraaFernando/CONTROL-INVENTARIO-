"use client";

import { useEffect } from "react";

const targetByVisibleLabel: Record<string, string> = {
  Inicio: "Resumen",
  Pedido: "Ventas",
  Pedidos: "Ventas",
  Clientes: "Clientes",
  Productos: "Inventario",
  Inventario: "Inventario",
  Movimientos: "Movimientos",
};

function compact(value: string | null | undefined) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function labelWithoutIcons(button: HTMLButtonElement) {
  const copy = button.cloneNode(true) as HTMLButtonElement;
  copy.querySelectorAll("span, i").forEach((node) => node.remove());
  return compact(copy.textContent);
}

function findOriginalButton(targetLabel: string) {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".sidebar nav > button:not([data-civ-simple-nav]), .mobile-nav > button:not([data-civ-simple-nav])",
    ),
  );

  return candidates.find((button) => labelWithoutIcons(button) === targetLabel)
    ?? candidates.find((button) => compact(button.textContent).includes(targetLabel))
    ?? null;
}

export default function SimpleNavigationRepair() {
  useEffect(() => {
    function bridge(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest<HTMLButtonElement>('button[data-civ-simple-nav="1"]');
      if (!button) return;

      const visibleLabel = labelWithoutIcons(button);
      if (visibleLabel === "Más") return;

      const targetLabel = targetByVisibleLabel[visibleLabel];
      if (!targetLabel) return;

      const original = findOriginalButton(targetLabel);
      if (!original) return;

      // Evita que el onClick antiguo vuelva a intentar resolver la navegación
      // con el texto completo que incluye el icono.
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      original.click();
    }

    document.addEventListener("click", bridge, true);
    return () => document.removeEventListener("click", bridge, true);
  }, []);

  return null;
}
