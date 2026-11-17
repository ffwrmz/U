import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });
}

// Tablas donde un trabajador puede dejar historial. Si tiene algo, no se elimina: se desactiva.
const HISTORIAL: [string, string][] = [
  ["ventas_pedidos", "vendedor_id"],
  ["pagos", "cobrador_id"],
  ["ruta_paradas", "vendedor_id"],
  ["inventario_movimientos", "usuario_id"],
  ["solicitudes_descuento", "solicitante_id"],
  ["solicitudes_descuento", "resuelto_por"],
  ["clientes", "creado_por"],
  ["productos", "creado_por"],
  ["ubicaciones_inventario", "responsable_id"],
  ["auditoria_movimientos", "usuario_id"],
  ["jornadas", "creado_por"],
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const user = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });

    // Solo el dueño (activo) puede usar esta función
    const { data: rol } = await user.rpc("get_rol_usuario");
    const { data: me } = await user.auth.getUser();
    if (rol !== "dueno" || !me?.user) return json({ error: "Solo el gerente puede administrar trabajadores." }, 403);

    const body = await req.json();
    const accion = body.accion as string;

    if (accion === "crear") {
      const email = String(body.email ?? "").trim().toLowerCase();
      const password = String(body.password ?? "");
      const nombre = String(body.nombre ?? "").trim();
      const rolNuevo = body.rol === "dueno" ? "dueno" : "vendedor";
      const telefono = body.telefono ? String(body.telefono) : null;
      if (!email || !nombre || password.length < 6) {
        return json({ error: "Faltan datos: nombre, correo y una contraseña de al menos 6 caracteres." }, 400);
      }
      const { data: creado, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !creado.user) {
        const msg = error?.message?.includes("already") ? "Ya existe un usuario con ese correo." : (error?.message ?? "No se pudo crear el usuario.");
        return json({ error: msg }, 400);
      }
      const { error: e2 } = await admin.from("perfiles").insert({ id: creado.user.id, nombre, rol: rolNuevo, email, telefono, activo: true });
      if (e2) {
        await admin.auth.admin.deleteUser(creado.user.id);
        return json({ error: "No se pudo guardar el perfil: " + e2.message }, 400);
      }
      return json({ ok: true, id: creado.user.id });
    }

    const id = String(body.id ?? "");
    if (!id) return json({ error: "Falta el trabajador." }, 400);
    if (id === me.user.id) return json({ error: "No puedes desactivarte ni eliminarte a ti mismo." }, 400);

    if (accion === "activar" || accion === "desactivar") {
      const activo = accion === "activar";
      const { error } = await admin.from("perfiles").update({ activo }).eq("id", id);
      if (error) return json({ error: error.message }, 400);
      // Bloquea o desbloquea el inicio de sesión
      await admin.auth.admin.updateUserById(id, { ban_duration: activo ? "none" : "876000h" });
      return json({ ok: true });
    }

    if (accion === "eliminar") {
      for (const [tabla, col] of HISTORIAL) {
        const { count } = await admin.from(tabla).select("*", { count: "exact", head: true }).eq(col, id);
        if ((count ?? 0) > 0) {
          return json({ error: "Este trabajador tiene historial (ventas, pagos, rutas u otros). No se puede eliminar; desactívalo.", historial: true }, 409);
        }
      }
      const { error } = await admin.from("perfiles").delete().eq("id", id);
      if (error) return json({ error: error.message }, 400);
      await admin.auth.admin.deleteUser(id);
      return json({ ok: true });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
