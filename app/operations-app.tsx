"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

export type OperationsTab = "proveedores" | "pedidos" | "facturacion" | "auditoria" | "corte";

type Product = { id: number; sku: string; name: string; cost: number; currentStock: number; setFactor: number; boxFactor: number };
type Client = { id: number; name: string; email: string };
type PermissionMap = Record<string, boolean>;
type Supplier = { id: number; name: string; businessName: string; taxId: string; phone: string; email: string; invoiceRequired: number; defaultPaymentMethod: string; creditDays: number };
type Order = { id: number; folio: string; supplierId: number; supplierName: string; status: string; receivedStatus: string; trackingNumber: string; expectedAt: string | null; paymentMethod: string; invoiceRequired: number; creditDays: number; dueDate: string | null; totalAmount: number; notes: string; createdBy: string; canceled: number; canceledBy: string; canceledAt: string | null; createdAt: string };
type OrderItem = { id: number; orderId: number; productId: number; sku: string; productName: string; presentation: string; presentationFactor: number; orderedQuantity: number; receivedQuantity: number; unitCost: number; totalAmount: number };
type Invoice = { id: number; direction: string; folio: string; uuid: string; clientId: number | null; supplierId: number | null; purchaseOrderId: number | null; counterparty: string; paymentMethod: string; creditDays: number; issueDate: string; dueDate: string; subtotal: number; taxAmount: number; totalAmount: number; paidAmount: number; status: string; notes: string; createdBy: string; canceled: number; canceledBy: string; canceledAt: string | null; createdAt: string };
type InvoiceFile = { id: number; invoiceId: number; kind: string; fileName: string; contentType: string; size: number; uploadedBy: string; createdAt: string };
type Payment = { id: number; invoiceId: number; amount: number; reference: string; paidAt: string; createdBy: string; voided: number };
type Audit = { id: number; entityType: string; entityId: number; action: string; userId: number; username: string; displayName: string; beforeJson: string; afterJson: string; reason: string; createdAt: string };
type Closure = { id: number; businessDate: string; movementCount: number; moneyIn: number; moneyOut: number; inventoryValue: number; summaryJson: string; closedBy: string; createdAt: string };
type ClosurePreview = { businessDate: string; movementCount: number; sales: number; purchases: number; receivedPayments: number; sentPayments: number; moneyIn: number; moneyOut: number; inventoryValue: number };
type OperationsData = { suppliers: Supplier[]; orders: Order[]; orderItems: OrderItem[]; invoices: Invoice[]; payments: Payment[]; files: InvoiceFile[]; audit: Audit[]; closures: Closure[]; closurePreview: ClosurePreview | null; today: string };

const money = new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" });
const dateTime = (value: string) => new Intl.DateTimeFormat("es-MX", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value.replace(" ", "T") + "Z"));
const dateOnly = (value?: string | null) => value ? new Intl.DateTimeFormat("es-MX", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00Z`)) : "—";

function daysUntil(value: string, today: string) {
  return Math.round((Date.parse(`${value}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
}

function paymentTone(invoice: Invoice, today: string) {
  if (invoice.canceled || invoice.status === "pagada") return "green";
  const days = daysUntil(invoice.dueDate, today);
  return days <= 0 ? "red" : days <= 7 ? "yellow" : "green";
}

function statusLabel(value: string) {
  return ({ pedido: "Pedido", transito: "En tránsito", entregado: "Entregado", sin_recibir: "Sin recibir", incompleto: "Incompleto", completo: "Completo" } as Record<string, string>)[value] ?? value;
}

export function OperationsApp({ tab, products, clients, permissions, onError, onChanged }: {
  tab: OperationsTab;
  products: Product[];
  clients: Client[];
  permissions: PermissionMap;
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const [data, setData] = useState<OperationsData | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    const response = await fetch("/api/operations", { cache: "no-store" });
    const json = await response.json();
    if (!response.ok) onError(json.error || "No se pudieron cargar las operaciones.");
    else setData(json);
    setLoading(false);
  }, [onError]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function post(action: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/operations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, ...payload }),
    });
    const json = await response.json();
    if (!response.ok) { onError(json.error || "No se pudo guardar."); return false; }
    await Promise.all([load(), onChanged()]);
    return true;
  }

  if (loading && !data) return <div className="loading">Cargando operación comercial…</div>;
  if (!data) return null;
  if (tab === "proveedores") return <Suppliers data={data} post={post} />;
  if (tab === "pedidos") return <Orders data={data} products={products} post={post} />;
  if (tab === "facturacion") return <Invoices data={data} clients={clients} permissions={permissions} post={post} reload={load} onError={onError} />;
  if (tab === "auditoria") return <AuditPanel rows={data.audit} />;
  return <Closures data={data} post={post} />;
}

function Suppliers({ data, post }: { data: OperationsData; post: (action: string, payload: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    if (await post("add_supplier", payload)) { event.currentTarget.reset(); setOpen(false); }
  }
  return <section className="card fill"><div className="card-head"><div><h2>Proveedores</h2><p>Condiciones comerciales, facturación y días de crédito.</p></div><button className="primary" onClick={() => setOpen(true)}>＋ Nuevo proveedor</button></div><div className="table-wrap"><table><thead><tr><th>Proveedor</th><th>RFC</th><th>Contacto</th><th>Factura</th><th>Método</th><th>Crédito</th></tr></thead><tbody>{data.suppliers.map(s => <tr key={s.id}><td><strong>{s.name}</strong><small>{s.businessName || "—"}</small></td><td>{s.taxId || "—"}</td><td>{s.email || s.phone || "—"}</td><td>{s.invoiceRequired ? "Sí" : "No"}</td><td><span className="pill blue">{s.defaultPaymentMethod}</span></td><td>{s.defaultPaymentMethod === "PPD" ? `${s.creditDays} días` : "Contado"}</td></tr>)}</tbody></table>{!data.suppliers.length && <Empty text="Registra proveedores para crear pedidos y cuentas por pagar." />}</div>{open && <Modal title="Nuevo proveedor" close={() => setOpen(false)}><form onSubmit={submit}><div className="form-grid"><Field label="Nombre *" name="name" required /><Field label="Razón social" name="businessName" /><Field label="RFC" name="taxId" /><Field label="Correo" name="email" type="email" /><Field label="Teléfono" name="phone" /><Select label="Método predeterminado" name="defaultPaymentMethod" options={[{ value: "PUE", label: "PUE · Una exhibición" }, { value: "PPD", label: "PPD · Parcialidades o diferido" }]} /><Field label="Días de crédito" name="creditDays" type="number" min="0" defaultValue="30" /><Check label="Requiere factura" name="invoiceRequired" defaultChecked /></div><Actions close={() => setOpen(false)} /></form></Modal>}</section>;
}

function Orders({ data, products, post }: { data: OperationsData; products: Product[]; post: (action: string, payload: Record<string, unknown>) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [receive, setReceive] = useState<Order | null>(null);
  const [items, setItems] = useState([{ productId: "", presentation: "pieza", quantity: "1", unitCost: "" }]);
  const orderItems = useCallback((id: number) => data.orderItems.filter(item => item.orderId === id), [data.orderItems]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    if (await post("create_order", { ...form, invoiceRequired: Boolean(form.invoiceRequired), items })) {
      setOpen(false); setItems([{ productId: "", presentation: "pieza", quantity: "1", unitCost: "" }]);
    }
  }
  async function receiveOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!receive) return;
    const form = new FormData(event.currentTarget);
    const quantities = orderItems(receive.id).map(item => ({ itemId: item.id, quantity: form.get(`item-${item.id}`) }));
    if (await post("receive_order", { orderId: receive.id, notes: form.get("notes"), items: quantities })) setReceive(null);
  }
  async function updateStatus(order: Order, status: string) {
    const trackingNumber = status === "transito" ? (window.prompt("Número de guía", order.trackingNumber) ?? order.trackingNumber) : order.trackingNumber;
    await post("update_order_status", { id: order.id, status, trackingNumber, expectedAt: order.expectedAt });
  }
  async function cancel(order: Order) {
    const reason = window.prompt("Motivo obligatorio de anulación");
    if (reason) await post("cancel_order", { id: order.id, reason });
  }
  return <section className="card fill"><div className="card-head"><div><h2>Pedidos y recepciones</h2><p>Seguimiento desde el pedido hasta la recepción completa o incompleta.</p></div><button className="primary" onClick={() => setOpen(true)}>＋ Nuevo pedido</button></div><div className="table-wrap"><table><thead><tr><th>Pedido</th><th>Proveedor</th><th>Estatus</th><th>Recepción</th><th>Guía</th><th>Esperado</th><th>Importe</th><th>Acciones</th></tr></thead><tbody>{data.orders.map(order => <tr key={order.id} className={order.canceled ? "voided-row" : ""}><td><code>{order.folio}</code><small>{order.createdBy}</small></td><td>{order.supplierName}</td><td>{order.canceled ? <Pill value="Anulado" tone="red" /> : <select className={`status-select ${order.status}`} value={order.status} onChange={e => updateStatus(order, e.target.value)}><option value="pedido">Pedido</option><option value="transito">En tránsito</option><option value="entregado">Entregado</option></select>}</td><td><Pill value={statusLabel(order.receivedStatus)} tone={order.receivedStatus === "completo" ? "green" : order.receivedStatus === "incompleto" ? "yellow" : "red"} /><small>{orderItems(order.id).reduce((sum, item) => sum + item.receivedQuantity, 0)} / {orderItems(order.id).reduce((sum, item) => sum + item.orderedQuantity, 0)} unidades</small></td><td>{order.trackingNumber || "—"}</td><td>{dateOnly(order.expectedAt)}</td><td>{money.format(order.totalAmount)}</td><td><div className="row-actions">{!order.canceled && <button className="mini" onClick={() => setReceive(order)}>Recibir</button>}{!order.canceled && <button className="mini danger" onClick={() => cancel(order)}>Anular</button>}</div></td></tr>)}</tbody></table>{!data.orders.length && <Empty text="Aún no hay pedidos registrados." />}</div>{open && <Modal title="Nuevo pedido" close={() => setOpen(false)}><form onSubmit={create}><div className="form-grid"><Field label="Folio *" name="folio" required /><Select label="Proveedor *" name="supplierId" options={data.suppliers.map(s => ({ value: String(s.id), label: s.name }))} /><Select label="Método de pago" name="paymentMethod" options={[{ value: "PUE", label: "PUE" }, { value: "PPD", label: "PPD" }]} /><Field label="Días de crédito" name="creditDays" type="number" min="0" defaultValue="30" /><Field label="Fecha esperada" name="expectedAt" type="date" /><Field label="Número de guía" name="trackingNumber" /><Check label="Requiere factura" name="invoiceRequired" defaultChecked /><Field label="Notas" name="notes" wide /></div><div className="line-editor"><h3>Productos</h3>{items.map((item, index) => <div className="line-row" key={index}><select value={item.productId} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, productId: e.target.value } : row))} required><option value="">Producto…</option>{products.map(product => <option key={product.id} value={product.id}>{product.sku} · {product.name}</option>)}</select><select value={item.presentation} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, presentation: e.target.value } : row))}><option value="pieza">Pieza</option><option value="unidad">Unidad</option><option value="ciento">Ciento</option><option value="juego">Juego</option><option value="caja">Caja</option></select><input aria-label="Cantidad" type="number" min="1" value={item.quantity} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, quantity: e.target.value } : row))} /><input aria-label="Costo unitario" type="number" min="0" step="0.01" placeholder="Costo unitario" value={item.unitCost} onChange={e => setItems(items.map((row, i) => i === index ? { ...row, unitCost: e.target.value } : row))} />{items.length > 1 && <button type="button" className="mini danger" onClick={() => setItems(items.filter((_, i) => i !== index))}>×</button>}</div>)}<button type="button" className="mini" onClick={() => setItems([...items, { productId: "", presentation: "pieza", quantity: "1", unitCost: "" }])}>＋ Agregar partida</button></div><Actions close={() => setOpen(false)} /></form></Modal>}{receive && <Modal title={`Recibir ${receive.folio}`} close={() => setReceive(null)}><form onSubmit={receiveOrder}><div className="receipt-list">{orderItems(receive.id).map(item => { const pending = item.orderedQuantity - item.receivedQuantity; return <label key={item.id}><span><strong>{item.productName}</strong><small>{item.receivedQuantity} recibidas · {pending} pendientes</small></span><input name={`item-${item.id}`} type="number" min="0" max={pending} defaultValue="0" /></label>; })}</div><div className="form-grid"><Field label="Observaciones de recepción" name="notes" wide /></div><p className="field-note">Solo las cantidades capturadas aumentarán el inventario. Una recepción parcial conservará el faltante pendiente.</p><Actions close={() => setReceive(null)} label="Registrar recepción" /></form></Modal>}</section>;
}

function Invoices({ data, clients, permissions, post, reload, onError }: { data: OperationsData; clients: Client[]; permissions: PermissionMap; post: (action: string, payload: Record<string, unknown>) => Promise<boolean>; reload: () => Promise<void>; onError: (message: string) => void }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState("cliente");
  const [method, setMethod] = useState("PUE");
  const [filesFor, setFilesFor] = useState<Invoice | null>(null);
  const warnings = useMemo(() => data.invoices.filter(invoice => !invoice.canceled && invoice.status !== "pagada").sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [data.invoices]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.currentTarget));
    if (await post("create_invoice", { ...payload, direction, paymentMethod: method })) setOpen(false);
  }
  async function pay(invoice: Invoice) {
    const amount = window.prompt(`Saldo: ${money.format(invoice.totalAmount - invoice.paidAmount)}. Importe del pago:`);
    if (!amount) return;
    const reference = window.prompt("Referencia del pago") ?? "";
    await post("add_payment", { invoiceId: invoice.id, amount, reference, paidAt: data.today });
  }
  async function cancel(invoice: Invoice) {
    const reason = window.prompt("Motivo obligatorio de cancelación");
    if (reason) await post("cancel_invoice", { invoiceId: invoice.id, reason });
  }
  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!filesFor) return;
    const form = new FormData(event.currentTarget);
    form.set("invoiceId", String(filesFor.id));
    const response = await fetch("/api/invoice-files", { method: "POST", body: form });
    const json = await response.json();
    if (!response.ok) onError(json.error || "No se pudo cargar el archivo."); else { await reload(); setFilesFor(null); }
  }
  function prepareEmail(invoice: Invoice) {
    const client = clients.find(row => row.id === invoice.clientId);
    const subject = encodeURIComponent(`Factura ${invoice.folio} · CIV`);
    const body = encodeURIComponent(`Se prepararon los documentos de la factura ${invoice.folio}. Descárgalos desde CIV y adjúntalos a este mensaje.`);
    window.location.href = `mailto:${encodeURIComponent(client?.email || "")}?subject=${subject}&body=${body}`;
  }
  return <div className="page-stack"><section className="warning-grid card"><div className="card-head"><div><h2>Próximos vencimientos</h2><p>Cuentas por cobrar y pagar.</p></div></div><div className="due-list">{warnings.slice(0, 8).map(invoice => { const days = daysUntil(invoice.dueDate, data.today); return <div key={invoice.id}><Pill value={invoice.direction === "cliente" ? "Por cobrar" : "Por pagar"} tone={paymentTone(invoice, data.today)} /><span><strong>{invoice.folio} · {invoice.counterparty}</strong><small>{days < 0 ? `${Math.abs(days)} días vencida` : days === 0 ? "Vence hoy" : `Vence en ${days} días`}</small></span><b>{money.format(invoice.totalAmount - invoice.paidAmount)}</b></div>; })}{!warnings.length && <Empty text="No hay pagos próximos." />}</div></section><section className="card fill"><div className="card-head"><div><h2>Facturación</h2><p>CFDI recibidos y enviados, PUE/PPD, saldos y archivos privados.</p></div><button className="primary" onClick={() => setOpen(true)}>＋ Registrar factura</button></div><div className="table-wrap"><table><thead><tr><th>Folio</th><th>Tipo</th><th>Cliente / proveedor</th><th>PUE/PPD</th><th>Vencimiento</th><th>Total</th><th>Saldo</th><th>Estatus</th><th>Documentos</th><th>Acciones</th></tr></thead><tbody>{data.invoices.map(invoice => <tr key={invoice.id} className={invoice.canceled ? "voided-row" : ""}><td><code>{invoice.folio}</code><small>{invoice.uuid || "Sin UUID"}</small></td><td>{invoice.direction === "cliente" ? "Cliente" : "Proveedor"}</td><td>{invoice.counterparty}</td><td><Pill value={invoice.paymentMethod} tone="blue" /><small>{invoice.creditDays ? `${invoice.creditDays} días` : "Contado"}</small></td><td><Pill value={dateOnly(invoice.dueDate)} tone={paymentTone(invoice, data.today)} /></td><td>{money.format(invoice.totalAmount)}</td><td><b>{money.format(invoice.totalAmount - invoice.paidAmount)}</b></td><td><Pill value={invoice.canceled ? "Cancelada" : invoice.status} tone={invoice.canceled ? "red" : invoice.status === "pagada" ? "green" : invoice.status === "parcial" ? "yellow" : "blue"} /></td><td>{data.files.filter(file => file.invoiceId === invoice.id).map(file => <a className="file-link" key={file.id} href={`/api/invoice-files?id=${file.id}`}>{file.kind.toUpperCase()}</a>)}</td><td><div className="row-actions">{permissions["invoices.files"] && !invoice.canceled && <button className="mini" onClick={() => setFilesFor(invoice)}>XML/PDF</button>}{!invoice.canceled && invoice.status !== "pagada" && <button className="mini" onClick={() => pay(invoice)}>Pago</button>}{invoice.direction === "cliente" && !invoice.canceled && <button className="mini" onClick={() => prepareEmail(invoice)}>Preparar envío</button>}{!invoice.canceled && <button className="mini danger" onClick={() => cancel(invoice)}>Cancelar</button>}</div></td></tr>)}</tbody></table>{!data.invoices.length && <Empty text="Aún no hay facturas registradas." />}</div>{open && <Modal title="Registrar factura" close={() => setOpen(false)}><form onSubmit={create}><div className="form-grid"><label><span>Tipo *</span><select value={direction} onChange={e => setDirection(e.target.value)}><option value="cliente">Enviada a cliente</option><option value="proveedor">Recibida de proveedor</option></select></label><Field label="Folio *" name="folio" required /><Field label="UUID fiscal" name="uuid" />{direction === "cliente" ? <Select label="Cliente *" name="clientId" options={clients.map(c => ({ value: String(c.id), label: c.name }))} /> : <Select label="Proveedor *" name="supplierId" options={data.suppliers.map(s => ({ value: String(s.id), label: s.name }))} />}<label><span>Método *</span><select name="paymentMethod" value={method} onChange={e => setMethod(e.target.value)}><option value="PUE">PUE</option><option value="PPD">PPD</option></select></label>{method === "PPD" && <Field label="Días de crédito" name="creditDays" type="number" min="1" defaultValue="30" />}<Field label="Fecha de emisión" name="issueDate" type="date" defaultValue={data.today} required /><Field label="Subtotal" name="subtotal" type="number" min="0" step="0.01" /><Field label="Impuestos" name="taxAmount" type="number" min="0" step="0.01" /><Field label="Total *" name="totalAmount" type="number" min="0.01" step="0.01" required /><Field label="Notas" name="notes" wide /></div><Actions close={() => setOpen(false)} /></form></Modal>}{filesFor && <Modal title={`Documentos · ${filesFor.folio}`} close={() => setFilesFor(null)}><form onSubmit={upload}><div className="form-grid"><Select label="Tipo de archivo" name="kind" options={[{ value: "xml", label: "XML fiscal" }, { value: "pdf", label: "Representación PDF" }]} /><label><span>Archivo *</span><input name="file" type="file" accept=".xml,.pdf,application/xml,application/pdf" required /></label></div><p className="field-note">Máximo 10 MB. Los archivos se almacenan de forma privada y requieren sesión y permiso para descargarse.</p><Actions close={() => setFilesFor(null)} label="Cargar archivo" /></form></Modal>}</section></div>;
}

function AuditPanel({ rows }: { rows: Audit[] }) {
  return <section className="card fill"><div className="card-head"><div><h2>Auditoría</h2><p>Bitácora inmutable de usuarios, fechas, cambios y anulaciones.</p></div></div><div className="audit-list">{rows.map(row => <details key={row.id}><summary><Pill value={row.action} tone={row.action.includes("anul") || row.action.includes("cancel") ? "red" : "blue"} /><span><strong>{row.entityType} #{row.entityId}</strong><small>{row.displayName} · {dateTime(row.createdAt)}</small></span></summary><div><p><b>Motivo:</b> {row.reason || "Sin motivo adicional"}</p><div className="audit-json"><pre>{prettyJson(row.beforeJson)}</pre><pre>{prettyJson(row.afterJson)}</pre></div></div></details>)}{!rows.length && <Empty text="Todavía no hay eventos de auditoría." />}</div></section>;
}

function Closures({ data, post }: { data: OperationsData; post: (action: string, payload: Record<string, unknown>) => Promise<boolean> }) {
  const preview = data.closurePreview;
  async function confirm() {
    if (!preview || !window.confirm(`¿Confirmar el corte del ${preview.businessDate}? El corte quedará inmutable.`)) return;
    await post("confirm_close", { businessDate: preview.businessDate });
  }
  return <div className="page-stack">{preview && <section className="stats closure-stats"><Stat label="Movimientos" value={String(preview.movementCount)} note={preview.businessDate} /><Stat label="Ventas" value={money.format(preview.sales)} note="Entradas operativas" /><Stat label="Compras" value={money.format(preview.purchases)} note="Salidas operativas" /><Stat label="Cobros registrados" value={money.format(preview.receivedPayments)} note="Pagos de clientes" /><Stat label="Pagos registrados" value={money.format(preview.sentPayments)} note="Pagos a proveedores" /><Stat label="Inventario final" value={money.format(preview.inventoryValue)} note="A costo de adquisición" /></section>}<section className="card"><div className="card-head"><div><h2>Corte diario</h2><p>Concilia movimientos, dinero e inventario. Esta versión no genera respaldos.</p></div>{preview && !data.closures.some(c => c.businessDate === preview.businessDate) && <button className="primary" onClick={confirm}>Confirmar corte de hoy</button>}</div><div className="table-wrap"><table><thead><tr><th>Fecha operativa</th><th>Movimientos</th><th>Entradas</th><th>Salidas</th><th>Inventario</th><th>Cerró</th><th>Hora</th></tr></thead><tbody>{data.closures.map(closure => <tr key={closure.id}><td><code>{closure.businessDate}</code></td><td>{closure.movementCount}</td><td>{money.format(closure.moneyIn)}</td><td>{money.format(closure.moneyOut)}</td><td>{money.format(closure.inventoryValue)}</td><td>{closure.closedBy}</td><td>{dateTime(closure.createdAt)}</td></tr>)}</tbody></table>{!data.closures.length && <Empty text="Aún no se ha confirmado ningún corte." />}</div></section></div>;
}

export function MovementAuditDialog({ movementId, close }: { movementId: number; close: () => void }) {
  const [rows, setRows] = useState<Audit[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/operations?entityType=movement&entityId=${movementId}`, { cache: "no-store" })
      .then(async response => { const json = await response.json(); if (!response.ok) throw new Error(json.error); setRows(json.audit); })
      .catch(reason => setError(reason instanceof Error ? reason.message : "No se pudo cargar la auditoría."));
  }, [movementId]);
  return <Modal title={`Auditoría del movimiento #${movementId}`} close={close}>{error && <div className="alert error">{error}</div>}{!rows ? <div className="loading">Cargando trazabilidad…</div> : <AuditPanel rows={rows} />}</Modal>;
}

function Modal({ title, close, children }: { title: string; close: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}><div className="modal operations-modal"><div className="modal-head"><div><p>CIV · CONTROL OPERATIVO</p><h2>{title}</h2></div><button onClick={close} aria-label="Cerrar">×</button></div><div className="operations-modal-body">{children}</div></div></div>;
}
function Actions({ close, label = "Guardar" }: { close: () => void; label?: string }) { return <div className="modal-actions"><button type="button" className="ghost" onClick={close}>Cancelar</button><button className="primary">{label}</button></div>; }
function Field({ label, name, wide = false, ...props }: { label: string; name: string; wide?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) { return <label className={wide ? "wide" : ""}><span>{label}</span><input name={name} {...props} /></label>; }
function Select({ label, name, options }: { label: string; name: string; options: { value: string; label: string }[] }) { return <label><span>{label}</span><select name={name} required><option value="">Seleccionar…</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>; }
function Check({ label, name, defaultChecked = false }: { label: string; name: string; defaultChecked?: boolean }) { return <label className="check-field"><input type="checkbox" name={name} defaultChecked={defaultChecked} /><span>{label}</span></label>; }
function Pill({ value, tone }: { value: string; tone: string }) { return <span className={`pill ${tone}`}>{value}</span>; }
function Stat({ label, value, note }: { label: string; value: string; note: string }) { return <article className="stat blue"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>; }
function Empty({ text }: { text: string }) { return <div className="empty"><span>✓</span><p>{text}</p></div>; }
function prettyJson(value: string) { try { return JSON.stringify(JSON.parse(value || "{}"), null, 2); } catch { return value; } }
