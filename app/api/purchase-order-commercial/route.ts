import { env } from "cloudflare:workers";
import { addDays, businessDate, ensureOperationalSchema, recordAudit } from "../../../db/operations";
import { AuthError, requirePermission, requireUser } from "../../auth";
import { normalizeCommercialUnit, presentationFactor } from "../../commercial-units";

type ItemInput={productId?:unknown;presentation?:unknown;quantity?:unknown;unitCost?:unknown};
function text(value:unknown){return String(value??"").trim()}
function errorResponse(error:unknown){if(error instanceof AuthError)return Response.json({error:error.message},{status:error.status});const message=error instanceof Error?error.message:"Error inesperado";if(message.includes("UNIQUE constraint failed"))return Response.json({error:"Ese folio de pedido ya existe."},{status:409});return Response.json({error:message},{status:500})}

export async function POST(request:Request){
  try{
    const user=await requireUser(request);requirePermission(user,"orders.manage");await ensureOperationalSchema();
    const body=await request.json() as Record<string,unknown>;const folio=text(body.folio).toUpperCase();const supplierId=Number(body.supplierId||0);const items=Array.isArray(body.items)?body.items as ItemInput[]:[];
    if(!folio||!supplierId||!items.length)throw new AuthError("Folio, proveedor y productos son obligatorios.",400);
    if(items.length>200)throw new AuthError("Un pedido no puede contener más de 200 partidas.",400);
    const supplier=await env.DB.prepare("SELECT id, default_payment_method, invoice_required, credit_days FROM suppliers WHERE id=? AND active=1 LIMIT 1").bind(supplierId).first<{id:number;default_payment_method:string;invoice_required:number;credit_days:number}>();
    if(!supplier)throw new AuthError("Proveedor no encontrado.",404);
    const method=text(body.paymentMethod||supplier.default_payment_method).toUpperCase()==="PPD"?"PPD":"PUE";let creditDays=method==="PUE"?0:Number(body.creditDays??supplier.credit_days??30);if(method==="PPD"&&(!Number.isInteger(creditDays)||creditDays<1))throw new AuthError("Los días de crédito deben ser un entero mayor a cero.",400);
    const normalized:Array<{productId:number;unit:string;presentation:string;factor:number;quantity:number;unitCost:number;total:number}>=[];const seen=new Set<number>();
    for(const item of items){const productId=Number(item.productId||0);const count=Number(item.quantity||0);if(!productId||!Number.isInteger(count)||count<1)throw new AuthError("Hay una cantidad o producto inválido en el pedido.",400);if(seen.has(productId))throw new AuthError("Cada producto debe aparecer una sola vez por pedido.",400);seen.add(productId);const product=await env.DB.prepare("SELECT id, unit, cost, box_factor AS boxFactor FROM products WHERE id=? AND active=1 LIMIT 1").bind(productId).first<{id:number;unit:string;cost:number;boxFactor:number}>();if(!product)throw new AuthError("Producto no encontrado.",404);const unit=normalizeCommercialUnit(product.unit);const presentation=text(item.presentation).toLowerCase()||unit;const factor=presentationFactor(product,presentation);if(!factor)throw new AuthError("Una presentación del pedido no está configurada para ese producto.",400);const quantity=count*factor;const raw=text(item.unitCost)?Number(item.unitCost):Number(product.cost||0);if(!Number.isFinite(raw)||raw<0)throw new AuthError("El costo por unidad comercial no es válido.",400);const unitCost=Math.round((raw+Number.EPSILON)*100)/100;normalized.push({productId,unit,presentation,factor,quantity,unitCost,total:Math.round((quantity*unitCost+Number.EPSILON)*100)/100})}
    const total=normalized.reduce((sum,item)=>sum+item.total,0);const created=businessDate();const dueDate=addDays(created,creditDays);const expectedAt=text(body.expectedAt);if(expectedAt&&!/^\d{4}-\d{2}-\d{2}$/.test(expectedAt))throw new AuthError("La fecha esperada no es válida.",400);
    const result=await env.DB.prepare(`INSERT INTO purchase_orders (folio,supplier_id,status,tracking_number,expected_at,payment_method,invoice_required,credit_days,due_date,total_amount,notes,created_by_user_id,created_by) VALUES (?,?,'pedido',?,?,?,?,?,?,?,?,?,?)`).bind(folio,supplierId,text(body.trackingNumber),expectedAt||null,method,body.invoiceRequired===false?0:1,creditDays,dueDate,total,text(body.notes),user.id,user.displayName).run();
    const orderId=Number(result.meta.last_row_id);await env.DB.batch(normalized.map(item=>env.DB.prepare(`INSERT INTO purchase_order_items (order_id,product_id,presentation,presentation_factor,ordered_quantity,unit_cost,total_amount) VALUES (?,?,?,?,?,?,?)`).bind(orderId,item.productId,item.presentation,item.factor,item.quantity,item.unitCost,item.total)));
    await recordAudit({entityType:"purchase_order",entityId:orderId,action:"crear",user,after:{folio,supplierId,method,creditDays,dueDate,total,commercialUnits:true,items:normalized}});
    return Response.json({ok:true,id:orderId,total},{status:201});
  }catch(error){return errorResponse(error)}
}
