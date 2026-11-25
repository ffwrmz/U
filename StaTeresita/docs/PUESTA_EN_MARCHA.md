# Santa Teresita: puesta en marcha

Pasos para dejar la app instalada en los teléfonos Android de los trabajadores (APK) y lista para el negocio.
Todos los comandos se corren dentro de la carpeta `StaTeresita`.

## 1. Antes de empezar: base de datos (Supabase)

Pegar y correr en **Supabase > SQL Editor** (en este orden) los archivos que aún no se hayan corrido:

1. `supabase/migrations/20261123160000_modo_sin_conexion.sql`
2. `supabase/migrations/20261124160000_finalizar_mi_ruta.sql`
3. `supabase/migrations/20261124190000_rut_trabajadores.sql`
4. `supabase/migrations/20261124200000_arreglos_pruebas_v13_r08.sql`
5. `supabase/migrations/20261124210000_normalizar_rut.sql`
6. `supabase/migrations/20261125020000_ajustes_permisos.sql`

Funciones (Edge Functions) en **Supabase > Edge Functions**:

- **login-rut** (nueva): *Deploy a new function > Via Editor*, nombre `login-rut`, pegar `supabase/functions/login-rut/index.ts`, desplegar y **desactivar "Verify JWT"** en su configuración.
- **gestionar-trabajador**: reemplazar su código por `supabase/functions/gestionar-trabajador/index.ts` y volver a desplegar.

Después, en la app (entrando con correo), ir a **Trabajadores** y ponerle el **RUT** a cada uno (incluido el gerente).

## 2. Cuenta de Expo y proyecto

1. Crear una cuenta gratis en <https://expo.dev>.
2. Instalar la herramienta y entrar:
   ```bash
   npm install -g eas-cli
   eas login
   ```
3. Vincular el proyecto (crea el proyecto en expo.dev y agrega su id a la configuración; hacer commit de ese cambio):
   ```bash
   eas init
   ```

## 3. Clave de Google Maps (obligatoria para el mapa en el APK)

En Expo Go el mapa funciona sin clave, pero en la app instalada no.

1. Entrar a <https://console.cloud.google.com> y crear un proyecto (ej. "Santa Teresita").
2. *APIs y servicios > Biblioteca* → buscar **Maps SDK for Android** → **Habilitar**.
3. *APIs y servicios > Credenciales > Crear credenciales > Clave de API*. Copiarla.
4. Restringir la clave (recomendado): *Restricciones de aplicación > Apps de Android* → agregar
   - nombre del paquete: `cl.santateresita.app`
   - huella SHA-1: la que muestra `eas credentials` (Android > preview/production > Keystore) después del primer build.
   - *Restricciones de API*: solo "Maps SDK for Android".
   (Google pide una tarjeta para activar la cuenta, pero el mapa en apps Android no tiene costo por uso.)
5. Guardar la clave en EAS como variable secreta (no va en el repositorio):
   ```bash
   eas env:create --name GOOGLE_MAPS_API_KEY --value "LA_CLAVE" --environment preview --environment production --visibility secret
   ```

## 4. Variables opcionales (EAS o archivo `.env`)

| Variable | Para qué | Si no se pone |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` | Otro proyecto de Supabase | Usa el proyecto actual |
| `EXPO_PUBLIC_OSRM_URL` | Servidor propio de rutas en auto | Usa el servidor público de demostración |
| `EXPO_PUBLIC_MODO_PRUEBAS` = `1` | Mostrar "Depuración del día" en la app instalada | Oculto (solo aparece en desarrollo) |

## 5. Crear el APK y compartirlo

```bash
eas build -p android --profile preview
```

Tarda unos 15 minutos. Al terminar, Expo entrega un **link y un QR**: se envían a los trabajadores, lo abren en el
teléfono, descargan el APK y lo instalan (Android pide permitir "instalar apps de fuentes desconocidas").
Al abrir la app por primera vez, aceptar los permisos de **ubicación** y **notificaciones**.

Para la tienda Google Play (opcional, cuenta de desarrollador USD 25 una vez): `eas build -p android --profile production` y `eas submit -p android`.

## 6. Publicar cambios después

- Cambios de la app: volver a correr `eas build -p android --profile preview` y compartir el link nuevo
  (cada trabajador instala encima; no se pierden datos, están en Supabase).
- Cambios en la base: como siempre, pegar el SQL nuevo en el SQL Editor.
- (Más adelante se puede activar `eas update` para enviar cambios sin reinstalar.)

## 7. Lista antes de operar

- [ ] SQL pendientes corridos (punto 1) y `select * from pruebas.todas();` con todo en PASA.
- [ ] login-rut desplegada (sin Verify JWT) y gestionar-trabajador actualizada.
- [ ] RUT puesto a todos los trabajadores; probar entrar con RUT.
- [ ] Borrar datos de prueba: correr `supabase/seeds/borrar_datos_prueba_calendario.sql` y eliminar o desactivar
      los clientes de prueba (los que dicen "(prueba)" en el nombre).
- [ ] Clave de Google Maps creada y guardada en EAS; el mapa se ve en el APK.
- [ ] Unir el PR #1 a `main` en GitHub.
- [ ] Supabase plan gratis: el proyecto **se pausa tras 7 días sin uso** y no tiene respaldos automáticos descargables.
      Con uso diario no se pausa; para el negocio conviene el plan Pro (respaldos diarios) o exportar respaldos
      periódicos (*Database > Backups* o `pg_dump`).
- [ ] Pendiente: servidor de rutas propio (`EXPO_PUBLIC_OSRM_URL`) y, si se necesitan avisos con la app cerrada,
      notificaciones push (requiere este build propio + configurar Firebase en EAS).
