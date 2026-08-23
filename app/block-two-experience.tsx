"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { normalizeCommercialUnit, presentationFactor, unitLabel, validBoxFactor } from "./commercial-units";
import styles from "./block-two-experience.module.css";

type Product = { id:number; sku:string; name:string; unit:string; currentStock:number; minimumStock:number; boxFactor:number };
type Data = { products:Product[]; auth:{ displayName:string; permissions:Record<string,boolean> } };
type CountRow = { id:number; productId:number; sku:string; productName:string; unit:string; reason:string; performedBy:string; createdAt:string; previousStock:number; physicalStock:number; difference:number };
type Mode = "physical" | "sobrante" | "faltante" | "defectuoso";

const dateTime = (value:string) => new Intl.DateTimeFormat("es-MX", { dateStyle:"medium", timeStyle:"short" }).format(new Date(value.replace(" ","T")+"Z"));
function buttonText(button:Element){return (button.textContent||"").replace(/\s+/g," ").trim()}
function findBaseButton(label:string){const candidates=Array.from(document.querySelectorAll<HTMLButtonElement>(".mobile-nav button, .sidebar nav button"));const normalized=label.toLocaleLowerCase("es-MX");return candidates.find(button=>buttonText(button).toLocaleLowerCase("es-MX").includes(normalized))??null}
function modeCopy(mode:Mode){
  if(mode==="physical")return{title:"Conteo físico",eyebrow:"COMPARAR INVENTARIO",help:"Compara lo que CIV dice contra lo que realmente encontraste, usando la unidad comercial del producto."};
  if(mode==="sobrante")return{title:"Registrar sobrante",eyebrow:"MERCANCÍA DE MÁS",help:"Registra mercancía adicional en la misma unidad que utilizas para vender."};
  if(mode==="faltante")return{title:"Registrar faltante",eyebrow:"MERCANCÍA FALTANTE",help:"Registra lo que físicamente falta respecto al inventario de CIV."};
  return{title:"Registrar producto dañado",eyebrow:"NO VENDIBLE",help:"Retira del inventario la unidad comercial que ya no puede venderse."};
}

export default function BlockTwoExperience(){
  const[title,setTitle]=useState(""),[mount,setMount]=useState<HTMLElement|null>(null),[data,setData]=useState<Data|null>(null),[counts,setCounts]=useState<CountRow[]>([]),[mode,setMode]=useState<Mode|null>(null),[productId,setProductId]=useState(""),[presentation,setPresentation]=useState("pieza"),[quantity,setQuantity]=useState("1"),[physicalStock,setPhysicalStock]=useState(""),[reason,setReason]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");

  const syncInterface=useCallback(()=>{
    const heading=document.querySelector<HTMLElement>(".content h1");
    const currentTitle=heading?.textContent?.trim()||"";
    setTitle(current=>current===currentTitle?current:currentTitle);
    const content=document.querySelector<HTMLElement>(".content");
    let target=document.querySelector<HTMLElement>("[data-civ-block-two-mount]");
    if(currentTitle==="Movimientos"&&content){
      if(!target){target=document.createElement("div");target.dataset.civBlockTwoMount="1";const firstCard=content.querySelector<HTMLElement>(".card.fill");if(firstCard)content.insertBefore(target,firstCard);else content.appendChild(target)}
      setMount(current=>current===target?current:target);
    }else if(target){target.remove();setMount(null)}
    document.querySelectorAll<HTMLElement>(".pill").forEach(pill=>{const text=pill.textContent?.trim();if(text==="conteo_fisico")pill.textContent="Conteo físico";if(text==="sobrante")pill.textContent="Sobrante";if(text==="faltante")pill.textContent="Faltante"});
    if(sessionStorage.getItem("civ-return-to-movements")==="1"){const button=findBaseButton("Movimientos");if(button){sessionStorage.removeItem("civ-return-to-movements");button.click()}}
  },[]);

  useEffect(()=>{const timer=window.setTimeout(syncInterface,0);const observer=new MutationObserver(syncInterface);observer.observe(document.body,{childList:true,subtree:true});return()=>{window.clearTimeout(timer);observer.disconnect();document.querySelector<HTMLElement>("[data-civ-block-two-mount]")?.remove()}},[syncInterface]);

  const load=useCallback(async()=>{try{const response=await fetch("/api/data",{cache:"no-store"});const json=await response.json() as Data&{error?:string};if(!response.ok)throw new Error(json.error||"No se pudo cargar el inventario.");setData(json);if(json.auth.permissions["movements.adjust"]||json.auth.permissions["audit.view"]){const countResponse=await fetch("/api/inventory-control",{cache:"no-store"});const countJson=await countResponse.json() as {counts?:CountRow[]};if(countResponse.ok)setCounts(countJson.counts??[])}}catch(value){setError(value instanceof Error?value.message:"No se pudo cargar el control físico.")}},[]);
  useEffect(()=>{if(title!=="Movimientos")return;const timer=window.setTimeout(()=>{void load()},0);return()=>window.clearTimeout(timer)},[title,load]);

  const permissions=data?.auth.permissions??{};
  const selected=useMemo(()=>data?.products.find(product=>String(product.id)===productId),[data,productId]);
  const baseUnit=normalizeCommercialUnit(selected?.unit||"pieza");
  const factor=selected?presentationFactor(selected,presentation)??1:1;
  const baseQuantity=Math.max(0,Math.floor(Number(quantity)||0))*factor;
  const countValue=Math.max(0,Math.floor(Number(physicalStock)||0));
  const difference=selected&&physicalStock!==""?countValue-selected.currentStock:0;

  function open(next:Mode){const product=data?.products[0];setMode(next);setProductId(String(product?.id??""));setPresentation(normalizeCommercialUnit(product?.unit||"pieza"));setQuantity("1");setPhysicalStock(product?String(product.currentStock):"");setReason("");setError("")}
  function close(){if(busy)return;setMode(null);setError("")}
  async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!mode)return;setBusy(true);setError("");try{const response=await fetch("/api/inventory-control",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(mode==="physical"?{action:"physical_count",productId:Number(productId),physicalStock:Number(physicalStock),reason}:{action:"stock_incident",incident:mode,productId:Number(productId),presentation,quantity:Number(quantity),reason})});const json=await response.json() as {message?:string;error?:string};if(!response.ok)throw new Error(json.error||"No se pudo registrar el movimiento.");setNotice(json.message||"Movimiento registrado correctamente.");setMode(null);await load();window.setTimeout(()=>{sessionStorage.setItem("civ-return-to-movements","1");window.location.reload()},800)}catch(value){setError(value instanceof Error?value.message:"No se pudo registrar el movimiento.")}finally{setBusy(false)}}

  if(!mount||title!=="Movimientos"||!data)return null;
  const panel=<div className={styles.panel}>{notice&&<div className={styles.notice}>{notice}</div>}<section className={styles.intro}><p>BLOQUE 2A · CONTROL FÍSICO</p><h2>¿Qué pasó con la mercancía?</h2><span>CIV cuenta cada producto en su unidad comercial. Un juego cuenta como un juego; su contenido interno no se multiplica.</span></section><section className={styles.actions}>{permissions["movements.adjust"]&&<button className={styles.action} onClick={()=>open("physical")}><b>✓</b><strong>Conteo físico</strong><small>Comparar CIV contra lo que realmente hay</small></button>}{permissions["movements.adjust"]&&<button className={styles.action} onClick={()=>open("sobrante")}><b>＋</b><strong>Sobrante</strong><small>Encontré mercancía de más</small></button>}{permissions["movements.adjust"]&&<button className={styles.action} onClick={()=>open("faltante")}><b>−</b><strong>Faltante</strong><small>Falta mercancía en el almacén</small></button>}{permissions["movements.defective"]&&<button className={styles.action} onClick={()=>open("defectuoso")}><b>!</b><strong>Dañado</strong><small>Producto que ya no puede venderse</small></button>}</section>{(permissions["movements.adjust"]||permissions["audit.view"])&&<section className={styles.history}><div className={styles.historyHead}><h3>Conteos recientes</h3><p>Las cantidades se muestran en la unidad de inventario de cada producto.</p></div>{counts.length?<div className={styles.counts}>{counts.slice(0,8).map(count=>{const unit=normalizeCommercialUnit(count.unit);return <div className={styles.count} key={count.id}><div><strong>{count.productName}</strong><small>Código {count.sku} · {dateTime(count.createdAt)}</small></div><div><small>CIV</small><span className={styles.number}>{count.previousStock} {unitLabel(unit,count.previousStock!==1)}</span></div><div><small>Físico</small><span className={styles.number}>{count.physicalStock} {unitLabel(unit,count.physicalStock!==1)}</span></div><div><small>Diferencia</small><span className={`${styles.number} ${count.difference>0?styles.positive:count.difference<0?styles.negative:styles.neutral}`}>{count.difference>0?"+":""}{count.difference}</span></div><div><strong>{count.performedBy}</strong><small>{count.reason}</small></div></div>})}</div>:<div className={styles.empty}>Todavía no hay conteos físicos registrados.</div>}</section>}</div>;

  const copy=mode?modeCopy(mode):null;
  const box=validBoxFactor(selected?.boxFactor);
  return <>{createPortal(panel,mount)}{mode&&copy&&<div className={styles.backdrop} onMouseDown={event=>{if(event.target===event.currentTarget)close()}}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={copy.title}><header className={styles.modalHead}><div><p>{copy.eyebrow}</p><h3>{copy.title}</h3><small>{copy.help}</small></div><button className={styles.close} onClick={close} disabled={busy}>×</button></header><form className={styles.form} onSubmit={submit}>{error&&<div className={styles.error}>{error}</div>}<div className={styles.grid}><label className={`${styles.field} ${styles.wide}`}><span>Producto *</span><select value={productId} onChange={event=>{const value=event.target.value;setProductId(value);const product=data.products.find(row=>String(row.id)===value);if(product){setPresentation(normalizeCommercialUnit(product.unit));if(mode==="physical")setPhysicalStock(String(product.currentStock))}}} required>{data.products.map(product=><option key={product.id} value={product.id}>{product.sku} · {product.name} · {product.currentStock} {unitLabel(product.unit,product.currentStock!==1)}</option>)}</select></label>{mode==="physical"?<label className={styles.field}><span>Conteo físico ({unitLabel(baseUnit,true)}) *</span><input type="number" inputMode="numeric" min="0" step="1" value={physicalStock} onChange={event=>setPhysicalStock(event.target.value)} required/></label>:<><label className={styles.field}><span>Forma *</span><select value={presentation} onChange={event=>setPresentation(event.target.value)}><option value={baseUnit}>{unitLabel(baseUnit).charAt(0).toUpperCase()+unitLabel(baseUnit).slice(1)} · 1 = 1</option>{box?<option value="caja">Caja · {box} {unitLabel(baseUnit,box!==1)}</option>:null}</select></label><label className={styles.field}><span>Cantidad *</span><input type="number" inputMode="numeric" min="1" step="1" value={quantity} onChange={event=>setQuantity(event.target.value)} required/></label></>}<label className={`${styles.field} ${styles.wide}`}><span>Motivo *</span><textarea value={reason} onChange={event=>setReason(event.target.value)} required/></label></div><div className={styles.preview}>{mode==="physical"?<><span>CIV tiene <b>{selected?.currentStock??0} {unitLabel(baseUnit,(selected?.currentStock??0)!==1)}</b></span><span>Conteo: <b>{countValue}</b></span><span>Diferencia: <b className={difference>0?styles.positive:difference<0?styles.negative:styles.neutral}>{difference>0?"+":""}{difference}</b></span></>:<><span>Registrarás <b>{baseQuantity} {unitLabel(baseUnit,baseQuantity!==1)}</b></span>{presentation==="caja"&&<span>1 caja = <b>{box} {unitLabel(baseUnit,box!==1)}</b></span>}</>}</div><footer className={styles.modalActions}><button type="button" onClick={close} disabled={busy}>Cancelar</button><button type="submit" className={styles.primary} disabled={busy}>{busy?"Guardando…":"Confirmar"}</button></footer></form></section></div>}</>;
}
