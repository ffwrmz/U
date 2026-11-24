// Tipos compartidos por el mapa de clientes (versión nativa y web).
// Basado en el mapa de kaffee000 (github.com/kaffee000/StaTeresita).

/** Un punto del mapa = una dirección con coordenadas guardadas en `direcciones`. */
export type UbicacionMapa = {
  id: string; // direcciones.id
  latitud: number;
  longitud: number;
  direccion: string; // "Calle 123, Pasaje, Sector, Comuna"
  clientes: { id: string; nombre: string; deuda: number }[];
  /** Texto dentro del marcador, por ejemplo el número de parada ("1", "2"...). */
  etiqueta?: string;
  /** Color del marcador; por defecto naranja si debe y verde si está al día. */
  color?: string;
};

export type MapaClientesProps = {
  ubicaciones: UbicacionMapa[];
  onPressCliente?: (clienteId: string) => void;
  /** Dibuja una línea uniendo los puntos en el orden recibido (ruta). */
  trazarRuta?: boolean;
  /** Camino real por calles para la línea de la ruta; si no viene, se une en línea recta. */
  trazado?: { latitud: number; longitud: number }[] | null;
  /** Punto destacado (id de UbicacionMapa): se dibuja más grande y el mapa se centra en él. */
  seleccionId?: string | null;
  /** Al tocar un punto (además de la burbuja con los datos). */
  onPressUbicacion?: (u: UbicacionMapa) => void;
  /** 'punto': marcadores como puntitos de color (mapa de clientes); por defecto alfiler o número. */
  estilo?: "pin" | "punto";
  /** Posición de un casero (seguimiento del gerente): punto azul propio, distinto del GPS del teléfono. */
  posicion?: { latitud: number; longitud: number; titulo?: string } | null;
  /** Ubicación actual del usuario ("Tú estás aquí"). */
  miUbicacion?: { latitud: number; longitud: number } | null;
  /** Modo "Seguirme": la cámara sigue la posición y gira según hacia dónde mira o avanza el teléfono. */
  seguirme?: boolean;
  /** Posición rápida para seguirme (cada ~2 s) y rumbo en grados (0 = norte). */
  navegacion?: { latitud: number; longitud: number; rumbo: number | null } | null;
  /** El usuario movió el mapa con el dedo: se deja de seguir. */
  onDejarDeSeguir?: () => void;
  /** Al cambiar este número el mapa vuelve a mirar al norte (sin inclinación). */
  norte?: number;
};

// Centro de Molina: vista inicial cuando aún no hay puntos
export const CENTRO_INICIAL = { latitud: -35.114, longitud: -71.282 };

export const titulo = (u: UbicacionMapa) =>
  u.clientes.length === 1 ? u.clientes[0].nombre : `${u.clientes.length} clientes`;

export const deudaTotal = (u: UbicacionMapa) =>
  u.clientes.reduce((s, c) => s + c.deuda, 0);

export const colorDe = (u: UbicacionMapa, verde: string, naranja: string) =>
  u.color ?? (deudaTotal(u) > 0 ? naranja : verde);
