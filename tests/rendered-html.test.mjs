import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { register } from "node:module";
import test from "node:test";

register("./cloudflare-workers-loader.mjs", import.meta.url);

const developmentPreviewMeta =
  /<meta(?=[^>]*\bname=["']codex-preview["'])(?=[^>]*\bcontent=["']development["'])[^>]*>/i;

test("renders development preview metadata", async () => {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  const response = await worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^text\/html\b/i,
  );
  const html = await response.text();
  assert.match(html, developmentPreviewMeta);
  assert.match(
    html,
    /https:\/\/control-inventario\.laraafernando\.workers\.dev\//,
  );
});

test("builds the larger mobile navigation and appearance settings", async () => {
  const assetsUrl = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = await readdir(assetsUrl);
  const css = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".css"))
        .map((name) => readFile(new URL(name, assetsUrl), "utf8")),
    )
  ).join("\n");
  const scripts = (
    await Promise.all(
      assetNames
        .filter((name) => name.startsWith("inventory-app-") && name.endsWith(".js"))
        .map((name) => readFile(new URL(name, assetsUrl), "utf8")),
    )
  ).join("\n");

  assert.match(css, /height:calc\(76px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(css, /min-height:64px/);
  assert.match(css, /html\[data-theme=dark\]/);
  assert.match(scripts, /Ajustes/);
  assert.match(scripts, /Modo claro/);
  assert.match(scripts, /Modo oscuro/);

  const serviceWorker = await readFile(
    new URL("../dist/client/sw.js", import.meta.url),
    "utf8",
  );
  assert.match(serviceWorker, /civ-shell-v3/);
  assert.match(serviceWorker, /notificationclick/);
});

test("builds classified movement navigation and canceled-sale drilldown", async () => {
  const assetsUrl = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = await readdir(assetsUrl);
  const scripts = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(new URL(name, assetsUrl), "utf8")),
    )
  ).join("\n");

  assert.match(scripts, /Movimientos clasificados/);
  assert.match(scripts, /Ventas anuladas/);
  assert.match(scripts, /Venta completa anulada/);
  assert.match(scripts, /Anulación parcial/);
  assert.match(scripts, /Pedidos realizados/);
  assert.match(scripts, /Pedidos anulados/);
  assert.match(scripts, /PEDIDO REALIZADO/);
  assert.match(scripts, /PEDIDO ANULADO/);
  assert.match(scripts, /Compras y entradas/);
  assert.match(scripts, /\/api\/movement-history/);
});

test("builds warehouse order alerts and canceled-sale cleanup", async () => {
  const assetsUrl = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = await readdir(assetsUrl);
  const scripts = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(new URL(name, assetsUrl), "utf8")),
    )
  ).join("\n");

  assert.match(scripts, /Activar notificaciones/);
  assert.match(scripts, /Nuevo pedido en CIV/);
  assert.match(scripts, /civ-warehouse-last-order-id/);
  assert.match(scripts, /Venta anulada · movimiento revertido/);
  assert.match(scripts, /Ya no debe surtirse ni contabilizarse como venta/);
  assert.match(scripts, /\/api\/field-order-warehouse/);
});

test("builds WhatsApp sharing for field orders", async () => {
  const assetsUrl = new URL("../dist/client/assets/", import.meta.url);
  const assetNames = await readdir(assetsUrl);
  const scripts = (
    await Promise.all(
      assetNames
        .filter((name) => name.endsWith(".js"))
        .map((name) => readFile(new URL(name, assetsUrl), "utf8")),
    )
  ).join("\n");

  assert.match(scripts, /Enviar por WhatsApp/);
  assert.match(scripts, /Compartir por WhatsApp/);
  assert.match(scripts, /Pedido CIV/);
  assert.match(scripts, /https:\/\/wa\.me\/\?text=/);
  assert.match(scripts, /Productos:/);
  assert.match(scripts, /Levantó:/);
});

test("field orders allow exact unit quantities without forcing the box maximum", async () => {
  const source = await readFile(
    new URL("../app/field-order-experience.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /type Line = \{ productId: number; quantity: string \}/);
  assert.match(source, /onFocus=\{\(event\) => event\.currentTarget\.select\(\)\}/);
  assert.match(source, /if \(value === "" \|\| \/\^\\d\+\$\/\.test\(value\)\)/);
  assert.match(source, /La caja es solo el empaque y no obliga a venderla completa/);
  assert.doesNotMatch(
    source,
    /Math\.max\(1, Math\.min\(product\.availableStock, Number\(event\.target\.value\) \|\| 1\)\)/,
  );
});

test("field order creation and cancellation stay visible and refresh availability", async () => {
  const historyApi = await readFile(
    new URL("../app/api/movement-history/route.ts", import.meta.url),
    "utf8",
  );
  const fieldOrders = await readFile(
    new URL("../app/field-order-experience.tsx", import.meta.url),
    "utf8",
  );
  const warehouse = await readFile(
    new URL("../app/field-order-warehouse-experience.tsx", import.meta.url),
    "utf8",
  );

  assert.match(historyApi, /ensureFieldOrderSchema/);
  assert.match(historyApi, /FROM field_orders o/);
  assert.match(historyApi, /o\.canceled_at AS canceledAt/);
  assert.match(historyApi, /o\.canceled_reason AS canceledReason/);
  assert.match(historyApi, /orders:/);
  assert.match(fieldOrders, /addEventListener\("civ:inventory-updated"/);
  assert.match(fieldOrders, /dispatchEvent\(new CustomEvent\("civ:inventory-updated"\)\)/);
  assert.match(warehouse, /dispatchEvent\(new CustomEvent\("civ:inventory-updated"\)\)/);
  assert.match(warehouse, /dispatchEvent\(new CustomEvent\("civ:inventory-changed"\)\)/);
});
