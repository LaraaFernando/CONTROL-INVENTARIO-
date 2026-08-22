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

## Código, nube y producción

- **Código fuente:** [GitHub — LaraaFernando/CONTROL-INVENTARIO-](https://github.com/LaraaFernando/CONTROL-INVENTARIO-).
- **Trabajo con la computadora apagada:** entorno de Codex Cloud `LaraaFernando/CONTROL-INVENTARIO-`.
- **Alojamiento:** OpenAI Sites sobre Cloudflare Workers y D1.
- **Aplicación publicada:** [control-inventario-negocio.messi020306.chatgpt.site](https://control-inventario-negocio.messi020306.chatgpt.site).

Un commit en GitHub todavía no es una publicación. La entrega queda completa cuando el PR se integra, GitHub Actions termina correctamente, Sites publica esa versión y se comprueba la URL productiva.

## Cambios desde el celular con la computadora apagada

1. En ChatGPT abre **Codex** e inicia una tarea de **Codex Cloud**; no elijas Remote, porque Remote ejecuta en la computadora conectada.
2. Selecciona el entorno `LaraaFernando/CONTROL-INVENTARIO-` y la rama base `main`.
3. Describe el cambio. Las reglas de [`AGENTS.md`](./AGENTS.md) exigen rama, PR, comprobaciones, integración, publicación y prueba real.
4. Considera terminada la solicitud únicamente cuando recibas enlaces del PR, commit, GitHub Actions y la aplicación publicada.

El iPhone no recibe una copia de los archivos fuente. La PWA instalada abre la versión publicada; por eso el despliegue y la prueba de producción son obligatorios.

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

La interfaz incluye soporte para Safari en iPhone y para instalación desde **Compartir → Añadir a pantalla de inicio**. El service worker busca una versión nueva al abrir la aplicación y cada hora; cuando hay una actualización muestra **Nueva versión disponible** para recargarla sin depender de los archivos de la computadora.



## Actualización automática desde ZIP

Este método queda disponible como recuperación, pero para cambios normales se recomienda Codex Cloud y PR. Al subir **un solo archivo `.zip` a la raíz de `main`**, el workflow primero ejecuta instalación, lint, build y pruebas sobre el contenido extraído. Sólo si todo termina correctamente reemplaza el código, conservando `.github`, `.openai` y `AGENTS.md`.

> En **Settings → Actions → General → Workflow permissions** debe estar habilitado **Read and write permissions** para que el workflow pueda guardar una actualización validada.

## Seguridad y permisos (v2)

La aplicación incluye autenticación propia para Cloudflare D1:

- Primer acceso: si no existen usuarios, la pantalla inicial permite crear el **Administrador inicial**.
- Contraseñas derivadas con PBKDF2 + salt; no se guardan contraseñas en texto plano.
- Sesiones mediante cookie `HttpOnly`, `Secure` y `SameSite=Lax`.
- Roles base: Administrador, Almacén, Ventas, Crédito / Administración y Solo consulta.
- Permisos individuales por usuario para productos, costos, movimientos, notas de crédito y administración de usuarios.
- La API valida cada permiso en el servidor; ocultar un botón no es la única protección.
- Los movimientos registran el nombre del usuario que los realizó.

### Productos

Los usuarios autorizados pueden modificar datos maestros del producto. La existencia se modifica únicamente mediante Movimientos para preservar la trazabilidad. La opción **Eliminar** realiza una baja lógica: oculta el producto del inventario activo, pero conserva sus movimientos históricos.

### Instalación en iPhone

La versión actual es una PWA. Desde Safari abre la URL de producción y usa **Compartir → Añadir a pantalla de inicio → Añadir**. Se abrirá en modo standalone con icono propio. Una versión `.ipa` para TestFlight/App Store sería una fase posterior y requiere el flujo de Apple Developer.

## Seguridad y control de acceso v3

- La primera cuenta se crea como **Administrador principal**.
- Puede existir un máximo de **2 administradores principales activos**. Solo estos dos perfiles pueden crear usuarios, cambiar roles y asignar/revocar permisos.
- El rol **Administrador operativo** conserva acceso amplio a la operación, pero no puede administrar usuarios ni permisos.
- Se agregaron permisos separados para editar/eliminar clientes, anular movimientos/ventas y eliminar notas de crédito.
- Las ventas se registran desde **Movimientos** usando el tipo **Venta**.
- Al anular un movimiento, la aplicación revierte automáticamente su efecto en inventario y conserva el registro marcado como anulado para auditoría.
- Productos, clientes y notas de crédito usan baja lógica para conservar referencias históricas.
- PBKDF2 usa 100,000 iteraciones para compatibilidad con Cloudflare Workers.
