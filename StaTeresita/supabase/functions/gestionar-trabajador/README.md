# Edge Function `gestionar-trabajador`

Ya está **desplegada en Supabase** desde el conector de Supabase (verify_jwt activado).
El código fuente no está en este repo; si se necesita cambiarla, hay que descargarla desde el panel
de Supabase (Edge Functions) o pedir una copia del código.

Solo la puede usar un usuario con rol `dueno`. La app la llama desde `src/app/trabajadores.tsx`:

```ts
supabase.functions.invoke('gestionar-trabajador', { body })
```

| `accion` | Cuerpo | Respuesta |
|---|---|---|
| `crear` | `nombre, email, password, rol ('vendedor' \| 'dueno'), telefono?` | `{ ok, id }` |
| `activar` / `desactivar` | `id` | `{ ok }` (también desbloquea/bloquea el inicio de sesión) |
| `eliminar` | `id` | `{ ok }`, o `409 { error, historial: true }` si tiene ventas, pagos, rutas, etc. |

Los errores vienen como `{ error: 'mensaje en español' }`. No permite desactivarse ni eliminarse a uno mismo.

En la base de datos: `perfiles` tiene `activo`, `email` y `telefono`, y `get_rol_usuario()` devuelve
`null` si el perfil está inactivo (un trabajador desactivado pierde sus permisos).
