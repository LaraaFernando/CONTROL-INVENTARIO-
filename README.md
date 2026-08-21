# Control de Inventario y Ventas

Aplicación web para controlar productos, existencias, movimientos diarios, clientes y notas de crédito.

## Funciones incluidas

- Alta de productos con SKU, costo, precio, inventario inicial y stock mínimo.
- Inventario actualizado automáticamente por cada movimiento.
- Entradas por compra, ventas, piezas defectuosas, devoluciones y ajustes.
- Validación para impedir salidas mayores a la existencia disponible.
- Directorio de clientes con datos comerciales y fiscales.
- Notas de crédito vinculadas a cliente y referencia de venta.
- Estados de notas: pendiente, aplicada y cancelada.
- Panel con unidades, valor del inventario, movimientos del día y alertas.
- Diseño adaptable para computadora, tableta y teléfono.

## Tecnología

- Next.js / React / TypeScript.
- Vinext para despliegue compatible con Cloudflare Workers.
- Drizzle ORM.
- Cloudflare D1 (SQLite) para almacenamiento persistente.

## Subir el proyecto a GitHub

1. Crea un repositorio vacío en GitHub.
2. Descomprime este proyecto en tu computadora.
3. Abre una terminal dentro de la carpeta.
4. Ejecuta:

```bash
git init
git add .
git commit -m "Primera versión de control de inventario"
git branch -M main
git remote add origin URL_DE_TU_REPOSITORIO
git push -u origin main
```

Sustituye `URL_DE_TU_REPOSITORIO` por la dirección que muestra GitHub.

## Uso local

Necesitas Node.js 22 o posterior.

```bash
npm install
npm run dev
```

La versión local necesita una base D1 o una configuración compatible de Cloudflare para guardar datos. Para comprobar que el proyecto compila:

```bash
npm run build
```

## Base de datos

El esquema está en `db/schema.ts` y la migración inicial en `drizzle/`.

Después de modificar el esquema genera una migración nueva con:

```bash
npm run db:generate
```

## Flujo recomendado

1. Registra clientes.
2. Registra productos y su inventario inicial.
3. Captura todas las entradas y salidas desde Movimientos.
4. Vincula las ventas con cliente y folio cuando corresponda.
5. Registra las notas de crédito con el cliente y venta relacionada.

## Mejoras posteriores sugeridas

- Roles y permisos detallados para administrador, almacén y vendedor.
- Edición y desactivación de productos.
- Reportes exportables a Excel o PDF.
- Módulo de cotizaciones, pedidos y cuentas por cobrar.
- Lectura de códigos de barras.

## Compatibilidad con iPhone / PWA

La interfaz incluye soporte para Safari en iPhone y para instalación desde **Compartir → Añadir a pantalla de inicio**. Se añadieron `viewport-fit=cover`, áreas seguras de iOS, tamaños táctiles, prevención del zoom automático en formularios y un `manifest.webmanifest` con iconos para pantalla de inicio.

