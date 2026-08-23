"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import styles from "./block-one-experience.module.css";

type Product = {
  id: number;
  sku: string;
  name: string;
  currentStock: number;
  minimumStock: number;
};

type Auth = {
  displayName: string;
  permissions: Record<string, boolean>;
};

type Data = {
  products: Product[];
  auth: Auth;
};

type OperationsData = {
  orders?: Array<{
    canceled: number;
    status: string;
    receivedStatus: string;
  }>;
};

type MenuView = "more" | "administration";

const primaryTitles = ["Inicio", "Ventas", "Inventario", "Movimientos"] as const;

function normalizedTitle(value?: string | null) {
  const title = value?.trim() || "";
  return title === "Resumen" ? "Inicio" : title;
}

function buttonText(button: Element) {
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function findNavigationButton(label: string) {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(".sidebar nav button, .mobile-nav button"),
  );
  return candidates.find((button) => buttonText(button) === label) ?? null;
}

export default function BlockOneExperience() {
  const [title, setTitle] = useState("Inicio");
  const [data, setData] = useState<Data | null>(null);
  const [pendingOrders, setPendingOrders] = useState<number | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [menuView, setMenuView] = useState<MenuView>("more");
  const [contentTarget, setContentTarget] = useState<HTMLElement | null>(null);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);

  const permissions = data?.auth?.permissions ?? {};

  const loadHomeData = useCallback(async () => {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const json = (await response.json()) as Data;
      if (!response.ok) return;
      setData(json);

      if (json.auth?.permissions?.["orders.manage"]) {
        const operationsResponse = await fetch("/api/operations", { cache: "no-store" });
        if (operationsResponse.ok) {
          const operations = (await operationsResponse.json()) as OperationsData;
          const pending = (operations.orders ?? []).filter(
            (order) =>
              !order.canceled &&
              (order.status !== "entregado" || order.receivedStatus !== "completo"),
          ).length;
          setPendingOrders(pending);
        }
      } else {
        setPendingOrders(null);
      }
    } catch {
      // La interfaz base sigue funcionando aun si el resumen no puede refrescarse.
    }
  }, []);

  const navigate = useCallback((label: string) => {
    const target = findNavigationButton(label);
    if (target) target.click();
    setMoreOpen(false);
    setMenuView("more");
  }, []);

  const openSettings = useCallback(() => {
    const settings = document.querySelector<HTMLButtonElement>(".settings-trigger");
    settings?.click();
    setMoreOpen(false);
    setMenuView("more");
  }, []);

  const triggerSaleExperience = useCallback(() => {
    const ghost = document.createElement("button");
    ghost.type = "button";
    ghost.textContent = "Nuevo registro";
    ghost.style.position = "fixed";
    ghost.style.left = "-10000px";
    ghost.style.top = "-10000px";
    ghost.setAttribute("aria-hidden", "true");
    document.body.appendChild(ghost);
    ghost.click();
    ghost.remove();
  }, []);

  const normalizeInterface = useCallback(() => {
    const content = document.querySelector<HTMLElement>(".content");
    const sidebarNav = document.querySelector<HTMLElement>(".sidebar nav");
    if (content) setContentTarget((current) => current === content ? current : content);
    if (sidebarNav) setSidebarTarget((current) => current === sidebarNav ? current : sidebarNav);

    const heading = document.querySelector<HTMLElement>(".content h1");
    if (heading) {
      const currentTitle = normalizedTitle(heading.textContent);
      if (heading.textContent?.trim() === "Resumen") heading.textContent = "Inicio";
      setTitle((current) => current === currentTitle ? current : currentTitle);
    }

    document.querySelectorAll<HTMLButtonElement>(".sidebar nav > button").forEach((button) => {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
    });

    const currentTitle = normalizedTitle(heading?.textContent);
    const dashboard = document.querySelector<HTMLElement>(".content .page-stack");
    if (dashboard) {
      if (currentTitle === "Inicio") {
        dashboard.dataset.civBlockOneHidden = "1";
        dashboard.style.display = "none";
      } else if (dashboard.dataset.civBlockOneHidden === "1") {
        dashboard.style.removeProperty("display");
        delete dashboard.dataset.civBlockOneHidden;
      }
    }

    document.querySelectorAll<HTMLElement>("th").forEach((cell) => {
      if (cell.textContent?.trim() === "SKU") cell.textContent = "Código";
    });
    document.querySelectorAll<HTMLElement>("label span").forEach((label) => {
      if (label.textContent?.trim() === "SKU *") label.textContent = "Código *";
    });
    document.querySelectorAll<HTMLInputElement>("input[placeholder]").forEach((input) => {
      if (input.placeholder.includes("SKU")) input.placeholder = input.placeholder.replace("SKU", "código");
    });

    document.querySelectorAll<HTMLElement>(".modal-head h2").forEach((headingNode) => {
      if (headingNode.textContent?.trim() === "Registrar movimiento / venta") {
        headingNode.textContent = "Registrar movimiento";
      }
    });

    document.querySelectorAll<HTMLButtonElement>(".header-actions .primary, .card-head .primary").forEach((button) => {
      const label = buttonText(button);
      if (currentTitle === "Ventas" && (label.includes("Nuevo registro") || label.includes("Registrar movimiento / venta"))) {
        button.textContent = "＋ Nueva venta";
      } else if (currentTitle === "Movimientos" && label.includes("Registrar movimiento / venta")) {
        button.textContent = "＋ Registrar movimiento";
      } else if (currentTitle === "Inventario" && label.includes("Nuevo registro")) {
        button.textContent = "＋ Nuevo producto";
      } else if (currentTitle === "Clientes" && label.includes("Nuevo registro")) {
        button.textContent = "＋ Nuevo cliente";
      }
    });
  }, []);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => normalizeInterface(), 0);
    const observer = new MutationObserver(() => normalizeInterface());
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(initialTimer);
      observer.disconnect();
    };
  }, [normalizeInterface]);

  useEffect(() => {
    if (title !== "Inicio") return;
    const refreshTimer = window.setTimeout(() => {
      void loadHomeData();
    }, 0);
    return () => window.clearTimeout(refreshTimer);
  }, [title, loadHomeData]);

  useEffect(() => {
    function capture(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      const button = target?.closest("button");
      if (!button) return;
      const label = buttonText(button);

      if (button.closest(".mobile-nav") && label === "Más") {
        event.preventDefault();
        event.stopPropagation();
        setMenuView("more");
        setMoreOpen(true);
        return;
      }

      if (title === "Ventas" && label.includes("Nueva venta")) {
        event.preventDefault();
        event.stopPropagation();
        triggerSaleExperience();
      }
    }

    document.addEventListener("click", capture, true);
    return () => document.removeEventListener("click", capture, true);
  }, [title, triggerSaleExperience]);

  const outOfStock = useMemo(
    () => data?.products.filter((product) => product.currentStock === 0).length ?? 0,
    [data],
  );
  const lowStock = useMemo(
    () => data?.products.filter(
      (product) => product.currentStock > 0 && product.currentStock <= product.minimumStock,
    ).length ?? 0,
    [data],
  );

  const canMove = Boolean(
    permissions["movements.purchase"] ||
    permissions["movements.sale"] ||
    permissions["movements.defective"] ||
    permissions["movements.returns"] ||
    permissions["movements.adjust"],
  );
  const canAdmin = Boolean(
    permissions["audit.view"] ||
    permissions["invoices.manage"] ||
    permissions["invoices.files"] ||
    permissions["closures.manage"] ||
    permissions["credit_notes.create"] ||
    permissions["credit_notes.status"] ||
    permissions["credit_notes.delete"] ||
    permissions["users.manage"],
  );

  const home = title === "Inicio" && contentTarget ? createPortal(
    <div className={styles.home}>
      <section className={styles.welcome}>
        <p>OPERACIÓN DIARIA</p>
        <h2>¿Qué quieres hacer?</h2>
        <span>Elige una opción. CIV te mostrará solo lo necesario para completar esa tarea.</span>
      </section>

      <section className={styles.actions}>
        {permissions["movements.sale"] && (
          <button className={styles.action} onClick={() => navigate("Ventas")}>
            <b>$</b><span><strong>Ventas</strong><small>¿Qué estás vendiendo?</small></span><i>›</i>
          </button>
        )}
        <button className={styles.action} onClick={() => navigate("Inventario")}>
          <b>▦</b><span><strong>Inventario</strong><small>¿Cuánto tengo?</small></span><i>›</i>
        </button>
        {permissions["orders.manage"] && (
          <button className={styles.action} onClick={() => navigate("Pedidos")}>
            <b>↓</b><span><strong>Recibir mercancía</strong><small>¿Qué recibí?</small></span><i>›</i>
          </button>
        )}
        {canMove && (
          <button className={styles.action} onClick={() => navigate("Movimientos")}>
            <b>⇄</b><span><strong>Movimientos</strong><small>¿Qué pasó con la mercancía?</small></span><i>›</i>
          </button>
        )}
      </section>

      <section className={styles.alerts}>
        <header><div><h3>Atención de inventario</h3><p>Solo mostramos lo que requiere una revisión rápida.</p></div></header>
        <div className={styles.alertGrid}>
          <button onClick={() => navigate("Inventario")}>
            <strong className={lowStock ? styles.warning : styles.ok}>{lowStock}</strong>
            <span>Con poco inventario</span><small>Por debajo o en el mínimo</small>
          </button>
          <button onClick={() => navigate("Inventario")}>
            <strong className={outOfStock ? styles.danger : styles.ok}>{outOfStock}</strong>
            <span>Productos agotados</span><small>Existencia actual en cero</small>
          </button>
          {permissions["orders.manage"] && (
            <button onClick={() => navigate("Pedidos")}>
              <strong className={(pendingOrders ?? 0) > 0 ? styles.warning : styles.ok}>{pendingOrders ?? "—"}</strong>
              <span>Pedidos por recibir</span><small>Mercancía pendiente de revisar</small>
            </button>
          )}
        </div>
      </section>
    </div>,
    contentTarget,
  ) : null;

  const desktopNavigation = sidebarTarget ? createPortal(
    <div className={styles.desktopNav}>
      {primaryTitles.map((item) => {
        if (item === "Ventas" && !permissions["movements.sale"]) return null;
        const icon = item === "Inicio" ? "⌂" : item === "Ventas" ? "$" : item === "Inventario" ? "▦" : "⇄";
        return <button key={item} className={title === item ? styles.activeNav : ""} onClick={() => navigate(item === "Inicio" ? "Resumen" : item)}><span>{icon}</span>{item}</button>;
      })}
      <button className={!primaryTitles.includes(title as (typeof primaryTitles)[number]) ? styles.activeNav : ""} onClick={() => { setMenuView("more"); setMoreOpen(true); }}><span>•••</span>Más</button>
    </div>,
    sidebarTarget,
  ) : null;

  return <>
    {home}
    {desktopNavigation}
    {moreOpen && (
      <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) { setMoreOpen(false); setMenuView("more"); } }}>
        <section className={styles.sheet} role="dialog" aria-modal="true" aria-label={menuView === "more" ? "Más opciones" : "Administración avanzada"}>
          <div className={styles.handle} />
          <header className={styles.sheetHead}>
            <div>
              <strong>{menuView === "more" ? "Más" : "Administración avanzada"}</strong>
              <small>{menuView === "more" ? "Clientes, compras y ajustes de CIV" : "Herramientas que no necesitas para la operación diaria"}</small>
            </div>
            <button onClick={() => { if (menuView === "administration") setMenuView("more"); else setMoreOpen(false); }} aria-label={menuView === "administration" ? "Volver" : "Cerrar"}>{menuView === "administration" ? "←" : "×"}</button>
          </header>

          {menuView === "more" ? (
            <div className={styles.menuGrid}>
              <button onClick={() => navigate("Clientes")}><span>♙</span><strong>Clientes</strong><small>Directorio y datos comerciales</small></button>
              {permissions["suppliers.manage"] && <button onClick={() => navigate("Proveedores")}><span>♧</span><strong>Proveedores</strong><small>Compras y condiciones comerciales</small></button>}
              {permissions["orders.manage"] && <button onClick={() => navigate("Pedidos")}><span>▣</span><strong>Pedidos</strong><small>Seguimiento y recepción</small></button>}
              {canAdmin && <button onClick={() => setMenuView("administration")}><span>▤</span><strong>Administración avanzada</strong><small>Auditoría, facturación y controles</small></button>}
              <button onClick={openSettings}><span>⚙</span><strong>Ajustes</strong><small>Apariencia y comodidad</small></button>
            </div>
          ) : (
            <div className={styles.menuGrid}>
              {permissions["audit.view"] && <button onClick={() => navigate("Auditoría")}><span>◎</span><strong>Auditoría</strong><small>Quién hizo qué, cuándo y por qué</small></button>}
              {(permissions["invoices.manage"] || permissions["invoices.files"]) && <button onClick={() => navigate("Facturación")}><span>▤</span><strong>Facturación y pagos</strong><small>XML/PDF, PUE/PPD y seguimiento</small></button>}
              {(permissions["credit_notes.create"] || permissions["credit_notes.status"] || permissions["credit_notes.delete"]) && <button onClick={() => navigate("Notas de crédito")}><span>↩</span><strong>Notas de crédito</strong><small>Control administrativo de notas</small></button>}
              {permissions["closures.manage"] && <button onClick={() => navigate("Corte diario")}><span>✓</span><strong>Corte diario</strong><small>Resumen financiero de la operación</small></button>}
              {permissions["users.manage"] && <button onClick={() => navigate("Usuarios")}><span>⚙</span><strong>Usuarios y permisos</strong><small>Control de accesos por persona</small></button>}
            </div>
          )}
        </section>
      </div>
    )}
  </>;
}
