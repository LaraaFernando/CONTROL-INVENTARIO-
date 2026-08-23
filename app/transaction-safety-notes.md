# Validaciones transaccionales CIV

- Venta: cliente obligatorio. El folio oficial lo genera CIV con una secuencia diaria y se guarda en `sales` con restricción UNIQUE.
- Devolución de cliente: cliente, folio de venta original y motivo obligatorios. El producto y la cantidad se validan contra lo vendido y devoluciones previas.
- Entrada de compra: folio o referencia obligatorio.
- Devolución a proveedor: folio o referencia y motivo obligatorios.
- Ajustes positivos/negativos: motivo obligatorio.
- Estas reglas se validan en servidor antes de modificar inventario.
