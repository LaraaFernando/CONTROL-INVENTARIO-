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
  role: string;
  permissions: Record<string, boolean>;
};

type Data = {
  products: Product[];
  auth: Auth;
};

type WarehouseSummary = {
  newOrders: number;
  preparing: number;
  inTransit: number;
  delivered: number;
};

type WarehouseData = { summary?: WarehouseSummary };

type NavItem = {
  label: string;
  target: string;
  icon: string;
  activeTitles: string[];
};

function buttonText(button: Element) {
  return (button.textContent || "").replace(/\s+/g, " ").trim();
}

function findNavigationButton(label: string) {
  const candidates = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      ".sidebar nav > button:not([data-civ-simple-nav]), .mobile-nav > button:not([data-civ-simple-nav])",
    ),
  );
  return candidates.find((button) => buttonText(button) === label) ?? null;
}

export default function BlockOneExperience() {
  const [title, setTitle] = useState("Inicio");
  const [data, setData] = useState<Data | null>(null);
  const [warehouseSummary, setWarehouseSummary] = useState<WarehouseSummary | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [contentTarget, setContentTarget] = useState<HTMLElement | null>(null);
  const [sidebarTarget, setSidebarTarget] = useState<HTMLElement | null>(null);
  const [mobileTarget, setMobileTarget] = useState<HTMLElement | null>(null);

  const permissions = data?.auth?.permissions ?? {};
  const sellerMode = Boolean(
    data?.auth?.role === "ventas"
      || (!permissions["orders.manage"] && permissions["movements.sale"]),
  );

  const navItems = useMemo<NavItem[]>(() => sellerMode
    ? [
        { label: "Inicio", target: "Resumen", icon: "⌂", activeTitles: ["Inicio"] },
        { label: "Pedido", target: "Ventas", icon: "＋", activeTitles: ["Pedido"] },
        { label: "Clientes", target: "Clientes", icon: "♙", activeTitles: ["Clientes"] },
        { label: "Productos", target: "Inventario", icon: "▦", activeTitles: ["Inventario"] },
      ]
    : [
        { label: "Inicio", target: "Resumen", icon: "⌂", activeTitles: ["Inicio"] },
        { label: "Pedidos", target: "Ventas", icon: "▣", activeTitles: ["Pedidos"] },
        { label: "Inventario", target: "Inventario", icon: "▦", activeTitles: ["Inventario"] },
        { label: "Movimientos", target: "Movimientos", icon: "⇄", activeTitles: ["Movimientos"] },
      ], [sellerMode]);

  const loadHomeData = useCallback(async () => {
    try {
      const response = await fetch("/api/data", { cache: "no-store" });
      const json = (await response.json()) as Data;
      if (!response.ok) return;
      setData(json);

      if (json.auth?.permissions?.["orders.manage"]) {
        const orderResponse = await fetch("/api/field-order-warehouse", { cache: "no-store" });
        if (orderResponse.ok) {
          const orderData = await orderResponse.json() as WarehouseData;
          setWarehouseSummary(orderData.summary ?? null);
        }
      } else {
        setWarehouseSummary(null);
      }
    } catch {
      // La navegación sigue disponible si el resumen no puede actualizarse.
    }
  }, []);

  const navigate = useCallback((targetLabel: string) => {
    const target = findNavigationButton(targetLabel);
    target?.click();
    setMoreOpen(false);
  }, []);

  const openSettings = useCallback(() => {
    document.querySelector<HTMLButtonElement>(".settings-trigger")?.click();
    setMoreOpen(false);
  }, []);

  const normalizeInterface = useCallback(() => {
    const content = document.querySelector<HTMLElement>(".content");
    const sidebarNav = document.querySelector<HTMLElement>(".sidebar nav");
    const mobileNav = document.querySelector<HTMLElement>(".mobile-nav");
    if (content) setContentTarget((current) => current === content ? current : content);
    if (sidebarNav) setSidebarTarget((current) => current === sidebarNav ? current : sidebarNav);
    if (mobileNav) setMobileTarget((current) => current === mobileNav ? current : mobileNav);

    document.querySelectorAll<HTMLButtonElement>(
      ".sidebar nav > button:not([data-civ-simple-nav]), .mobile-nav > button:not([data-civ-simple-nav])",
    ).forEach((button) => {
      button.style.display = "none";
      button.setAttribute("aria-hidden", "true");
    });

    const heading = content?.querySelector<HTMLElement>(":scope > header h1")
      ?? document.querySelector<HTMLElement>(".content h1");
    let currentTitle = heading?.textContent?.trim() || "";
    if (heading) {
      if (currentTitle === "Resumen") {
        heading.textContent = "Inicio";
        currentTitle = "Inicio";
      } else if (["Ventas", "Pedido", "Pedidos"].includes(currentTitle)) {
        const next = sellerMode ? "Pedido" : "Pedidos";
        if (heading.textContent !== next) heading.textContent = next;
        currentTitle = next;
      }
      setTitle((current) => current === currentTitle ? current : currentTitle);
    }

    const pageStack = content?.querySelector<HTMLElement>(":scope > .page-stack")
      ?? document.querySelector<HTMLElement>(".content .page-stack");
    const hideLegacyPage = ["Inicio", "Pedido", "Pedidos"].includes(currentTitle);
    if (pageStack) {
      if (hideLegacyPage) {
        if (pageStack.style.display !== "none") pageStack.style.display = "none";
        pageStack.dataset.civSimpleHidden = "1";
      } else if (pageStack.dataset.civSimpleHidden === "1") {
        pageStack.style.removeProperty("display");
        delete pageStack.dataset.civSimpleHidden;
      }
    }

    const headerPrimary = content?.querySelector<HTMLButtonElement>(":scope > header .header-actions .primary");
    if (headerPrimary) {
      if (["Pedido", "Pedidos"].includes(currentTitle)) {
        headerPrimary.style.display = "none";
        headerPrimary.dataset.civSimpleHidden = "1";
      } else if (headerPrimary.dataset.civSimpleHidden === "1") {
        headerPrimary.style.removeProperty("display");
        delete headerPrimary.dataset.civSimpleHidden;
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
  }, [sellerMode]);

  useEffect(() => {
    const initialTimer = window.setTimeout(normalizeInterface, 0);
    const observer = new MutationObserver(normalizeInterface);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      window.clearTimeout(initialTimer);
      observer.disconnect();
    };
  }, [normalizeInterface]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadHomeData(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadHomeData]);

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
  const openFieldOrders = (warehouseSummary?.newOrders ?? 0) + (warehouseSummary?.preparing ?? 0);

  const home = title === "Inicio" && contentTarget ? createPortal(
    <div className={styles.home}>
      <section className={styles.welcome}>
        <p>{sellerMode ? "VENTA EN CAMPO" : "OPERACIÓN DE ALMACÉN"}</p>
        <h2>{sellerMode ? "¿Qué necesitas hacer en la visita?" : "¿Qué necesita atención?"}</h2>
        <span>{sellerMode
          ? "Registra el cliente, levanta el pedido y envíalo al almacén desde aquí."
          : "Atiende pedidos, controla existencias y prepara la salida de mercancía."}</span>
      </section>

      <section className={styles.actions}>
        {sellerMode ? <>
          <button className={styles.action} onClick={() => navigate("Ventas")}>
            <b>＋</b><span><strong>Levantar pedido</strong><small>Crear y enviar pedido al almacén</small></span><i>›</i>
          </button>
          <button className={styles.action} onClick={() => navigate("Clientes")}>
            <b>♙</b><span><strong>Clientes</strong><small>Registrar o consultar un negocio</small></span><i>›</i>
          </button>
          <button className={styles.action} onClick={() => navigate("Inventario")}>
            <b>▦</b><span><strong>Consultar productos</strong><small>Precio y disponibilidad para vender</small></span><i>›</i>
          </button>
          <button className={styles.action} onClick={() => navigate("Ventas")}>
            <b>▣</b><span><strong>Mis pedidos</strong><small>Revisar pedidos levantados y su avance</small></span><i>›</i>
          </button>
        </> : <>
          <button className={styles.action} onClick={() => navigate("Ventas")}>
            <b>▣</b><span><strong>Pedidos</strong><small>{openFieldOrders ? `${openFieldOrders} requieren atención` : "Revisar y preparar pedidos"}</small></span><i>›</i>
          </button>
          <button className={styles.action} onClick={() => navigate("Inventario")}>
            <b>▦</b><span><strong>Inventario</strong><small>Físico, apartado y disponible</small></span><i>›</i>
          </button>
          <button className={styles.action} onClick={() => navigate("Clientes")}>
            <b>♙</b><span><strong>Clientes</strong><small>Directorio de clientes</small></span><i>›</i>
          </button>
          {permissions["suppliers.manage"] && <button className={styles.action} onClick={() => navigate("Proveedores")}>
            <b>♧</b><span><strong>Proveedores</strong><small>Datos y abastecimiento</small></span><i>›</i>
          </button>}
        </>}
      </section>

      {!sellerMode && <section className={styles.alerts}>
        <header><div><h3>Atención rápida</h3><p>Solo lo que requiere revisión operativa.</p></div></header>
        <div className={styles.alertGrid}>
          <button onClick={() => navigate("Ventas")}>
            <strong className={openFieldOrders ? styles.warning : styles.ok}>{openFieldOrders}</strong>
            <span>Pedidos por preparar</span><small>Nuevos + preparando</small>
          </button>
          <button onClick={() => navigate("Inventario")}>
            <strong className={lowStock ? styles.warning : styles.ok}>{lowStock}</strong>
            <span>Poco inventario</span><small>En mínimo o por debajo</small>
          </button>
          <button onClick={() => navigate("Inventario")}>
            <strong className={outOfStock ? styles.danger : styles.ok}>{outOfStock}</strong>
            <span>Agotados</span><small>Existencia física en cero</small>
          </button>
        </div>
      </section>}
    </div>,
    contentTarget,
  ) : null;

  const desktopNavigation = sidebarTarget ? createPortal(
    <div className={styles.desktopNav} data-civ-simple-nav="1">
      {navItems.map((item) => <button
        key={item.label}
        data-civ-simple-nav="1"
        className={item.activeTitles.includes(title) ? styles.activeNav : ""}
        onClick={() => navigate(item.target)}
      ><span>{item.icon}</span>{item.label}</button>)}
      <button data-civ-simple-nav="1" className={!navItems.some((item) => item.activeTitles.includes(title)) ? styles.activeNav : ""} onClick={() => setMoreOpen(true)}><span>•••</span>Más</button>
    </div>,
    sidebarTarget,
  ) : null;

  const mobileNavigation = mobileTarget ? createPortal(<>
    {navItems.map((item) => <button
      key={item.label}
      data-civ-simple-nav="1"
      className={item.activeTitles.includes(title) ? "active" : ""}
      onClick={() => navigate(item.target)}
    ><span>{item.icon}</span>{item.label}</button>)}
    <button data-civ-simple-nav="1" className={moreOpen || !navItems.some((item) => item.activeTitles.includes(title)) ? "active" : ""} onClick={() => setMoreOpen(true)}><span>•••</span>Más</button>
  </>, mobileTarget) : null;

  return <>
    {home}
    {desktopNavigation}
    {mobileNavigation}
    {moreOpen && (
      <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) setMoreOpen(false); }}>
        <section className={styles.sheet} role="dialog" aria-modal="true" aria-label="Más opciones">
          <div className={styles.handle} />
          <header className={styles.sheetHead}>
            <div><strong>Más</strong><small>{sellerMode ? "Seguimiento y ajustes" : "Clientes, proveedores y control"}</small></div>
            <button onClick={() => setMoreOpen(false)} aria-label="Cerrar">×</button>
          </header>
          <div className={styles.menuGrid}>
            {sellerMode ? <>
              <button onClick={() => navigate("Ventas")}><span>▣</span><strong>Mis pedidos</strong><small>Seguimiento de pedidos levantados</small></button>
              <button onClick={() => navigate("Clientes")}><span>♙</span><strong>Clientes</strong><small>Directorio y alta de clientes</small></button>
              <button onClick={openSettings}><span>⚙</span><strong>Ajustes</strong><small>Apariencia y comodidad</small></button>
            </> : <>
              <button onClick={() => navigate("Clientes")}><span>♙</span><strong>Clientes</strong><small>Directorio y datos comerciales</small></button>
              {permissions["suppliers.manage"] && <button onClick={() => navigate("Proveedores")}><span>♧</span><strong>Proveedores</strong><small>Datos y abastecimiento</small></button>}
              {permissions["orders.manage"] && <button onClick={() => navigate("Pedidos")}><span>↓</span><strong>Compras a proveedor</strong><small>Pedidos de mercancía para surtir almacén</small></button>}
              {permissions["audit.view"] && <button onClick={() => navigate("Auditoría")}><span>◎</span><strong>Auditoría</strong><small>Quién hizo cada movimiento</small></button>}
              {permissions["users.manage"] && <button onClick={() => navigate("Usuarios")}><span>♙</span><strong>Usuarios</strong><small>Accesos y permisos</small></button>}
              <button onClick={openSettings}><span>⚙</span><strong>Ajustes</strong><small>Apariencia y comodidad</small></button>
            </>}
          </div>
        </section>
      </div>
    )}
  </>;
}
