# Reglas de entrega para CIV

## Fuente de verdad

- La fuente de verdad es `LaraaFernando/CONTROL-INVENTARIO-` en GitHub; `main` representa el código aprobado.
- No afirmes que una modificación está publicada si sólo existe en un checkout local, un worktree, una rama o un PR.
- Antes de trabajar, parte del `main` remoto más reciente y usa una rama `codex/*`. No empujes cambios de aplicación directamente a `main`.
- La producción oficial que consume la PWA instalada es el Worker existente `control-inventario`, en `https://control-inventario.laraafernando.workers.dev`. Un despliegue únicamente en `chatgpt.site` no completa la entrega.
- Conserva `.openai/hosting.json` para compatibilidad del proyecto, pero no crees otro Site, Worker o D1. Reutiliza siempre `control-inventario` y `control-inventario-db`.
- Toda modificación destinada a producción debe actualizar `public/release.json` con un identificador de versión nuevo y único. GitHub Actions compara ese archivo con `https://control-inventario.laraafernando.workers.dev/release.json`; una versión que no coincida significa que Cloudflare todavía no tiene el cambio.

## Validación obligatoria

Para cada cambio de código ejecuta, como mínimo:

```bash
npm ci
npm run lint
npm test
```

- Si cambia `db/schema.ts`, genera e inspecciona la migración correspondiente antes de publicar.
- No uses datos reales para pruebas destructivas. Las operaciones de producción que creen, cambien o eliminen inventario requieren una cuenta o procedimiento de prueba autorizado.
- Conserva los bindings y datos persistentes de Sites. Cualquier cambio de D1, R2, autenticación o permisos debe tratarse como cambio de infraestructura y verificarse expresamente.
- El workflow de `main` debe terminar en verde, incluida la comprobación de `public/release.json` contra el Worker real. Un PR verde por sí solo no demuestra que producción esté actualizada.

## Entrega desde Codex Cloud

Salvo que el usuario pida explícitamente un borrador o trabajo local, una solicitud de modificación de la aplicación tiene como destino producción. La entrega no está terminada hasta completar estas etapas:

1. Crear una rama `codex/*` desde el `main` remoto vigente.
2. Implementar y ejecutar lint, build y pruebas.
3. Actualizar `public/release.json` con una versión única para esa entrega.
4. Guardar los cambios en GitHub y abrir un PR hacia `main`.
5. Esperar a que GitHub Actions termine correctamente.
6. Integrar el PR sólo cuando sea fusionable y las comprobaciones estén en verde.
7. Publicar el código exacto integrado en el Worker existente `control-inventario`, conservando su D1.
8. Esperar a que el despliegue indique `succeeded`.
9. Esperar a que el workflow de `main` confirme que `/release.json` coincide con el commit integrado.
10. Abrir la URL productiva y realizar una comprobación real y no destructiva del cambio solicitado.

Si alguna etapa no puede completarse, di exactamente dónde quedó el trabajo y no uses las palabras “publicado”, “en producción” ni “ya funciona en el celular”.

## Evidencia que debe recibir el usuario

La respuesta final de una entrega debe incluir:

- enlace del PR;
- enlace o SHA del commit integrado en `main`;
- resultado y enlace de GitHub Actions;
- identificador o evidencia del despliegue de Cloudflare y URL productiva;
- identificador de `public/release.json` confirmado en producción;
- qué se comprobó en la aplicación publicada.

La aplicación del iPhone es una PWA: consume la URL productiva, no una copia del checkout local. Después de un despliegue, verifica también que la actualización pueda recibirse al recargar o mediante el aviso “Nueva versión disponible”.
