from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
app = root / "app" / "inventory-app.tsx"
sales = root / "app" / "sales-experience.tsx"
css = root / "app" / "globals.css"
release = root / "public" / "release.json"

text = app.read_text(encoding="utf-8")


def replace_once(source: str, old: str, new: str, label: str) -> str:
    if old not in source:
        raise SystemExit(f"No se encontró el bloque esperado: {label}")
    return source.replace(old, new, 1)

text = replace_once(
    text,
    'type Tab="resumen"|"ventas"|"inventario"|"movimientos"|"clientes"|"notas"|OperationsTab|"usuarios";',
    'type Tab="resumen"|"ventas"|"inventario"|"movimientos"|"clientes"|"notas"|"administracion"|OperationsTab|"usuarios";',
    "tipo Tab",
)

text = re.sub(
    r'const baseTabs:\{id:Tab;label:string;icon:string\}\[\]=\[\n.*?\n\];',
    '''const baseTabs:{id:Tab;label:string;icon:string}[]=[
  {id:"resumen",label:"Inicio",icon:"⌂"},
  {id:"ventas",label:"Ventas",icon:"$"},
  {id:"inventario",label:"Inventario",icon:"▦"},
  {id:"movimientos",label:"Movimientos",icon:"⇄"},
];''',
    text,
    count=1,
    flags=re.S,
)

text = re.sub(
    r'const movementLabels:Record<string,string>=\{.*?\};',
    'const movementLabels:Record<string,string>={inventario_inicial:"Inventario inicial",entrada_compra:"Entrada de mercancía",venta:"Venta",defectuoso:"Producto dañado",devolucion_cliente:"Devolución de cliente",devolucion_proveedor:"Devolución a proveedor",ajuste_positivo:"Sobrante / ajuste positivo",ajuste_negativo:"Faltante / ajuste negativo"};',
    text,
    count=1,
)

text = re.sub(
    r'  const tabs=useMemo\(\(\)=>\{.*?  \},\[user\.permissions\]\);',
    '''  const tabs=useMemo(()=>{
    const rows=[...baseTabs,{id:"clientes" as Tab,label:"Clientes",icon:"♙"}];
    if(user.permissions["suppliers.manage"])rows.push({id:"proveedores" as Tab,label:"Proveedores",icon:"♧"});
    if(user.permissions["orders.manage"])rows.push({id:"pedidos" as Tab,label:"Pedidos",icon:"▣"});
    if(user.permissions["audit.view"])rows.push({id:"auditoria" as Tab,label:"Auditoría",icon:"◎"});
    const hasAdministration=user.permissions["invoices.manage"]||user.permissions["invoices.files"]||user.permissions["closures.manage"]||user.permissions["credit_notes.create"]||user.permissions["credit_notes.status"]||user.permissions["credit_notes.delete"]||user.permissions["users.manage"];
    if(hasAdministration)rows.push({id:"administracion" as Tab,label:"Administración",icon:"▤"});
    if(user.permissions["invoices.manage"])rows.push({id:"facturacion" as Tab,label:"Facturación y pagos",icon:"▤"});
    if(user.permissions["closures.manage"])rows.push({id:"corte" as Tab,label:"Corte diario",icon:"✓"});
    if(user.permissions["credit_notes.create"]||user.permissions["credit_notes.status"]||user.permissions["credit_notes.delete"])rows.push({id:"notas" as Tab,label:"Notas de crédito",icon:"↩"});
    if(user.permissions["users.manage"])rows.push({id:"usuarios" as Tab,label:"Usuarios y permisos",icon:"⚙"});
    return rows;
  },[user.permissions]);''',
    text,
    count=1,
    flags=re.S,
)

sidebar_pattern = re.compile(r'<nav>\{tabs\.map\(t=><button key=\{t\.id\}.*?</nav>', re.S)
sidebar_replacement = '''<nav>{tabs.filter(t=>["resumen","ventas","inventario","movimientos"].includes(t.id)).map(t=><button key={t.id} className={tab===t.id?"active":""} onClick={()=>setTab(t.id)}><span>{t.icon}</span>{t.label}</button>)}<button className={moreOpen||!["resumen","ventas","inventario","movimientos"].includes(tab)?"active":""} onClick={()=>setMoreOpen(true)}><span>•••</span>Más</button></nav>'''
text, sidebar_count = sidebar_pattern.subn(sidebar_replacement, text, count=1)
if sidebar_count != 1:
    raise SystemExit("No se pudo simplificar la navegación lateral")

text = text.replace(
    '["clientes","proveedores","pedidos","facturacion","auditoria","corte","usuarios","notas"]',
    '["clientes","proveedores","pedidos","auditoria","administracion"]',
    1,
)
text = text.replace('<strong>Más módulos</strong>', '<strong>Más</strong>', 1)

text = replace_once(
    text,
    '<Dashboard data={data} setTab={setTab} open={setModal} permissions={user.permissions}/>',
    '<Dashboard data={data} setTab={setTab} permissions={user.permissions}/>',
    "dashboard principal",
)

text = replace_once(
    text,
    '{tab==="ventas"&&<Movements rows={data.movements.filter(m=>m.type==="venta")} permissions={user.permissions} open={()=>setModal("movement")} inspect={setAuditMovement}',
    '{tab==="ventas"&&<Movements rows={data.movements.filter(m=>m.type==="venta")} permissions={user.permissions} salesView open={()=>setModal("movement")} inspect={setAuditMovement}',
    "vista de ventas",
)

admin_render = '{tab==="administracion"&&<AdministrationHub permissions={user.permissions} setTab={setTab}/>} '
needle = '{operationsTabs.includes(tab as OperationsTab)&&<OperationsApp'
if needle not in text:
    raise SystemExit("No se encontró el punto de inserción de Administración")
text = text.replace(needle, admin_render + needle, 1)

text = text.replace('>＋ Nuevo registro</button>', '>{tab==="ventas"?"＋ Nueva venta":tab==="inventario"?"＋ Nuevo producto":tab==="clientes"?"＋ Nuevo cliente":tab==="notas"?"＋ Nueva nota":"＋ Registrar movimiento"}</button>', 1)

start = text.index('function Dashboard(')
end = text.index('\nfunction Inventory(', start)
new_dashboard = '''function Dashboard({data,setTab,permissions}:{data:Data;setTab:(t:Tab)=>void;permissions:PermissionMap}){
  const outOfStock=data.products.filter(product=>product.currentStock===0).length;
  const lowStock=data.products.filter(product=>product.currentStock>0&&product.currentStock<=product.minimumStock).length;
  return <div className="home-page">
    <section className="home-welcome"><p>OPERACIÓN DIARIA</p><h2>¿Qué quieres hacer?</h2><span>Elige una opción. CIV te mostrará solo lo necesario para completar esa tarea.</span></section>
    <section className="home-actions">
      {permissions["movements.sale"]&&<button className="home-action sales" onClick={()=>setTab("ventas")}><b>$</b><span><strong>Ventas</strong><small>¿Qué estás vendiendo?</small></span><i>›</i></button>}
      <button className="home-action inventory" onClick={()=>setTab("inventario")}><b>▦</b><span><strong>Inventario</strong><small>¿Cuánto tengo?</small></span><i>›</i></button>
      {permissions["orders.manage"]&&<button className="home-action receive" onClick={()=>setTab("pedidos")}><b>↓</b><span><strong>Recibir mercancía</strong><small>¿Qué recibí?</small></span><i>›</i></button>}
      {canAnyMovement(permissions)&&<button className="home-action movements" onClick={()=>setTab("movimientos")}><b>⇄</b><span><strong>Movimientos</strong><small>¿Qué pasó con la mercancía?</small></span><i>›</i></button>}
    </section>
    <section className="home-alerts card">
      <div className="home-section-head"><div><h3>Atención de inventario</h3><p>Solo lo que requiere una revisión rápida.</p></div></div>
      <div className="home-alert-grid">
        <button onClick={()=>setTab("inventario")}><strong className={lowStock?"warning-number":""}>{lowStock}</strong><span>Con poco inventario</span><small>Por debajo o en el mínimo</small></button>
        <button onClick={()=>setTab("inventario")}><strong className={outOfStock?"danger-text":""}>{outOfStock}</strong><span>Productos agotados</span><small>Existencia actual en cero</small></button>
        {permissions["orders.manage"]&&<button onClick={()=>setTab("pedidos")}><strong>→</strong><span>Pedidos por recibir</span><small>Revisar mercancía pendiente</small></button>}
      </div>
    </section>
  </div>;
}
'''
text = text[:start] + new_dashboard + text[end:]

mov_start = text.index('function Movements(')
mov_end = text.index('\nfunction MovementTable(', mov_start)
new_movements = '''function Movements({rows,permissions,open,remove,inspect,salesView=false}:{rows:Movement[];permissions:PermissionMap;open:()=>void;remove:(m:Movement)=>Promise<void>;inspect:(id:number)=>void;salesView?:boolean}){const canCreate=salesView?permissions["movements.sale"]:canAnyMovement(permissions);return <section className="card fill"><div className="card-head"><div><h2>{salesView?"Ventas registradas":"Historial de movimientos"}</h2><p>{salesView?"Consulta las ventas y abre su auditoría cuando necesites revisar quién la registró.":"Entradas, salidas, devoluciones y ajustes con trazabilidad completa."}</p></div>{canCreate&&<button className="primary" onClick={open}>{salesView?"＋ Nueva venta":"＋ Registrar movimiento"}</button>}</div><MovementTable rows={rows} canDelete={permissions["movements.delete"]} canAudit={permissions["audit.view"]} remove={remove} inspect={inspect}/>{!rows.length&&<Empty text={salesView?"Aún no hay ventas registradas.":"Aún no hay movimientos registrados."}/>}</section>}
'''
text = text[:mov_start] + new_movements + text[mov_end:]

admin_hub = '''function AdministrationHub({permissions,setTab}:{permissions:PermissionMap;setTab:(tab:Tab)=>void}){
  return <section className="admin-hub card fill"><div className="card-head"><div><h2>Administración</h2><p>Funciones administrativas separadas de la operación diaria para mantener CIV sencilla.</p></div></div><div className="admin-grid">
    {(permissions["invoices.manage"]||permissions["invoices.files"])&&<button onClick={()=>setTab("facturacion")}><span>▤</span><strong>Facturación y pagos</strong><small>Documentos, PUE/PPD y seguimiento de pagos</small></button>}
    {(permissions["credit_notes.create"]||permissions["credit_notes.status"]||permissions["credit_notes.delete"])&&<button onClick={()=>setTab("notas")}><span>↩</span><strong>Notas de crédito</strong><small>Control administrativo de notas y estatus</small></button>}
    {permissions["closures.manage"]&&<button onClick={()=>setTab("corte")}><span>✓</span><strong>Corte diario</strong><small>Resumen financiero y cierre de operación</small></button>}
    {permissions["users.manage"]&&<button onClick={()=>setTab("usuarios")}><span>⚙</span><strong>Usuarios y permisos</strong><small>Quién puede ver y modificar cada área</small></button>}
  </div></section>;
}

'''
users_marker = 'function UsersPanel('
if users_marker not in text:
    raise SystemExit("No se encontró UsersPanel")
text = text.replace(users_marker, admin_hub + users_marker, 1)

# Lenguaje visible: conservar el campo técnico `sku`, pero mostrar "Código" al usuario.
text = text.replace('Buscar por SKU, producto o categoría', 'Buscar por código, producto o categoría')
text = text.replace('<th>SKU</th>', '<th>Código</th>')
text = text.replace('label="SKU *"', 'label="Código *"')
text = text.replace('Alta de SKU e inventario', 'Alta de código e inventario')
text = text.replace('Registrar movimiento / venta', 'Registrar movimiento')

app.write_text(text, encoding="utf-8")

sales_text = sales.read_text(encoding="utf-8")
sales_text = sales_text.replace('!label.includes("Nuevo registro") && !label.includes("Registrar movimiento / venta")', '!label.includes("Nuevo registro") && !label.includes("Nueva venta") && !label.includes("Registrar movimiento / venta")')
sales.write_text(sales_text, encoding="utf-8")

block_css = r'''

/* Bloque 1 · CIV Operación simple y legible */
.home-page{display:grid;gap:22px;max-width:1120px}.home-welcome{padding:6px 2px}.home-welcome p{margin:0 0 7px;color:var(--blue);font-size:11px;font-weight:900;letter-spacing:.15em}.home-welcome h2{margin:0;font-size:clamp(27px,3vw,38px);letter-spacing:-.035em}.home-welcome span{display:block;margin-top:8px;color:var(--muted);font-size:15px;line-height:1.5;max-width:690px}.home-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.home-action{min-height:142px;border:1px solid var(--line);border-radius:18px;background:#fff;color:var(--ink);padding:24px;display:grid;grid-template-columns:58px 1fr 24px;align-items:center;gap:18px;text-align:left;cursor:pointer;box-shadow:var(--shadow);transition:transform .16s ease,box-shadow .16s ease,border-color .16s ease}.home-action:hover{transform:translateY(-2px);border-color:color-mix(in srgb,var(--blue) 40%,var(--line));box-shadow:0 14px 36px rgba(20,31,53,.11)}.home-action b{width:58px;height:58px;border-radius:16px;display:grid;place-items:center;background:#edf3ff;color:var(--blue);font-size:27px}.home-action strong,.home-action small{display:block}.home-action strong{font-size:clamp(23px,2.2vw,30px);font-weight:850;letter-spacing:-.025em}.home-action small{margin-top:7px;color:var(--muted);font-size:14px;font-weight:500;line-height:1.35}.home-action i{font-style:normal;font-size:30px;color:#a5adba}.home-action.receive b{background:#e8f7ef;color:var(--green)}.home-action.movements b{background:#fff4df;color:#b66b00}.home-action.sales b{background:#eaf1ff;color:var(--blue)}.home-alerts{overflow:visible}.home-section-head{padding:20px 22px;border-bottom:1px solid var(--line)}.home-section-head h3{margin:0;font-size:18px}.home-section-head p{margin:5px 0 0;color:var(--muted);font-size:13px}.home-alert-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:0}.home-alert-grid button{min-height:118px;border:0;border-right:1px solid var(--line);background:transparent;color:var(--ink);padding:20px 22px;text-align:left;cursor:pointer}.home-alert-grid button:last-child{border-right:0}.home-alert-grid strong,.home-alert-grid span,.home-alert-grid small{display:block}.home-alert-grid strong{font-size:29px;line-height:1;color:var(--green)}.home-alert-grid .warning-number{color:var(--orange)}.home-alert-grid span{margin-top:10px;font-weight:800;font-size:14px}.home-alert-grid small{margin-top:4px;color:var(--muted);font-size:12px;line-height:1.35}.admin-hub{max-width:1040px}.admin-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;padding:20px}.admin-grid button{min-height:126px;border:1px solid var(--line);border-radius:14px;background:#fff;color:var(--ink);padding:20px;text-align:left;cursor:pointer;display:grid;grid-template-columns:44px 1fr;column-gap:14px;align-items:start}.admin-grid button>span{grid-row:1/3;width:44px;height:44px;border-radius:12px;background:#eef3ff;color:var(--blue);display:grid;place-items:center;font-size:21px}.admin-grid strong{font-size:18px}.admin-grid small{color:var(--muted);font-size:12px;line-height:1.45;margin-top:5px}.more-backdrop{display:grid;position:fixed;inset:0;z-index:70;background:rgba(9,17,30,.48);place-items:center;padding:24px}.more-sheet{width:min(620px,100%);max-height:min(720px,88vh);overflow:auto;background:#fff;border-radius:20px;box-shadow:0 26px 80px rgba(0,0,0,.25);padding:20px}.more-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.more-grid button{min-height:96px}.sidebar nav button{min-height:48px;font-size:14px}.content h1{font-weight:850}.card-head h2{font-size:19px}.card-head p{font-size:13px;line-height:1.45}
html[data-theme="dark"] .home-action,html[data-theme="dark"] .admin-grid button,html[data-theme="dark"] .more-sheet{background:#1b2535;color:var(--ink)}html[data-theme="dark"] .home-action b,html[data-theme="dark"] .admin-grid button>span{background:#263a57}html[data-theme="dark"] .home-alert-grid button{color:var(--ink)}
@media(max-width:900px){.home-actions{grid-template-columns:1fr}.home-alert-grid{grid-template-columns:1fr}.home-alert-grid button{border-right:0;border-bottom:1px solid var(--line)}.home-alert-grid button:last-child{border-bottom:0}.admin-grid{grid-template-columns:1fr}}
@media(max-width:760px){.home-page{gap:16px}.home-welcome{padding:2px 2px 4px}.home-welcome h2{font-size:29px}.home-welcome span{font-size:14px}.home-actions{gap:12px}.home-action{min-height:126px;border-radius:17px;padding:20px 18px;grid-template-columns:52px 1fr 18px;gap:14px}.home-action b{width:52px;height:52px;border-radius:14px;font-size:25px}.home-action strong{font-size:24px}.home-action small{font-size:14px;margin-top:5px}.home-alerts{border-radius:16px}.home-alert-grid button{min-height:104px}.more-backdrop{align-items:end;padding:0}.more-sheet{width:100%;max-height:82dvh;border-radius:22px 22px 0 0;padding:18px max(14px,env(safe-area-inset-right)) calc(92px + env(safe-area-inset-bottom)) max(14px,env(safe-area-inset-left))}.more-grid{grid-template-columns:1fr 1fr}.more-grid button{min-height:94px}.card-head h2{font-size:18px}.card-head p{font-size:13px}}
'''

css_text = css.read_text(encoding="utf-8")
marker = "/* Bloque 1 · CIV Operación simple y legible */"
if marker in css_text:
    css_text = css_text[:css_text.index(marker)].rstrip() + "\n"
css.write_text(css_text.rstrip() + block_css + "\n", encoding="utf-8")

release.write_text('{\n  "release": "2026-08-22-bloque1-operacion-simple-v1"\n}\n', encoding="utf-8")

print("Bloque 1 aplicado correctamente")
