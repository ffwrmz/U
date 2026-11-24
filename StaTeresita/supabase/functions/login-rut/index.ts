// Iniciar sesión con RUT y contraseña.
// Recibe { rut, password }, busca (con permisos de servicio) el correo del trabajador activo con ese RUT
// e inicia sesión con ese correo. Devuelve la sesión para que la app la use (supabase.auth.setSession).
// Nunca dice si el RUT existe: ante cualquier problema responde "RUT o contraseña incorrectos".
// Desplegar con "Verify JWT" desactivado (se llama antes de tener sesión).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const limpiar = (t: string) => t.replace(/[^0-9kK]/g, "").toUpperCase();
const dvDe = (cuerpo: string) => {
  let suma = 0, mul = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) { suma += Number(cuerpo[i]) * mul; mul = mul === 7 ? 2 : mul + 1; }
  const r = 11 - (suma % 11);
  return r === 11 ? "0" : r === 10 ? "K" : String(r);
};

// Límite simple: 8 intentos fallidos por RUT cada 10 minutos (por instancia de la función)
const fallos = new Map<string, { n: number; desde: number }>();
const VENTANA = 10 * 60 * 1000;
const bloqueado = (rut: string) => {
  const f = fallos.get(rut);
  if (!f || Date.now() - f.desde > VENTANA) return false;
  return f.n >= 8;
};
const anotarFallo = (rut: string) => {
  const f = fallos.get(rut);
  if (!f || Date.now() - f.desde > VENTANA) fallos.set(rut, { n: 1, desde: Date.now() });
  else f.n++;
};

const INCORRECTO = { error: "RUT o contraseña incorrectos" };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const l = limpiar(String(body.rut ?? ""));
    const password = String(body.password ?? "");
    const cuerpo = l.slice(0, -1);
    if (!/^\d{6,8}$/.test(cuerpo) || dvDe(cuerpo) !== l.slice(-1) || !password) return json(INCORRECTO, 401);
    const rut = `${cuerpo}-${l.slice(-1)}`;
    if (bloqueado(rut)) return json({ error: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo." }, 429);

    const url = Deno.env.get("SUPABASE_URL")!;
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: perfil } = await admin.from("perfiles").select("id, email, activo").eq("rut", rut).maybeSingle();
    if (!perfil || perfil.activo === false) { anotarFallo(rut); return json(INCORRECTO, 401); }

    // Correo de la cuenta (el de perfiles o, si falta, el de la cuenta de acceso)
    let email = perfil.email as string | null;
    if (!email) {
      const { data: u } = await admin.auth.admin.getUserById(perfil.id);
      email = u?.user?.email ?? null;
    }
    if (!email) { anotarFallo(rut); return json(INCORRECTO, 401); }

    const publico = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { auth: { persistSession: false } });
    const { data, error } = await publico.auth.signInWithPassword({ email, password });
    if (error || !data.session) {
      anotarFallo(rut);
      if (/banned/i.test(error?.message ?? "")) return json({ error: "Tu cuenta está desactivada. Habla con el gerente." }, 403);
      return json(INCORRECTO, 401);
    }
    fallos.delete(rut);
    return json({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
  } catch {
    return json({ error: "No se pudo iniciar sesión. Inténtalo de nuevo." }, 500);
  }
});
