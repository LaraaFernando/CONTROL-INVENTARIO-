"use client";

import { useEffect, useState } from "react";

export default function PwaUpdater() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    let registration: ServiceWorkerRegistration | undefined;
    const found = (worker: ServiceWorker | null) => worker && setWaiting(worker);
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(reg => {
      registration = reg;
      found(reg.waiting);
      reg.addEventListener("updatefound", () => reg.installing?.addEventListener("statechange", () => {
        if (reg.installing?.state === "installed" && navigator.serviceWorker.controller) found(reg.installing);
      }));
      void reg.update();
    }).catch(() => { /* La aplicación sigue operativa aun si el navegador no admite el registro. */ });
    const refresh = () => window.location.reload();
    navigator.serviceWorker.addEventListener("controllerchange", refresh);
    const timer = window.setInterval(() => void registration?.update(), 60 * 60 * 1000);
    return () => { window.clearInterval(timer); navigator.serviceWorker.removeEventListener("controllerchange", refresh); };
  }, []);
  if (!waiting) return null;
  return <aside className="update-banner" role="status"><span><strong>Nueva versión disponible</strong><small>Actualiza cuando termines la operación en curso.</small></span><button onClick={() => waiting.postMessage({ type: "SKIP_WAITING" })}>Actualizar ahora</button></aside>;
}
