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
  assert.match(serviceWorker, /civ-shell-v2/);
});
