// Mapa de clientes para iOS / Android (react-native-maps).
// Basado en el mapa de kaffee000 (github.com/kaffee000/StaTeresita).
// La versión web está en MapaClientes.web.tsx (Metro elige el archivo según la plataforma).

import { Palette } from "@/constants/palette";
import { Ionicons } from "@expo/vector-icons";
import { clp } from "@/lib/format";
import { alCambiarConexion, hayConexion } from "@/lib/offline/red";
import { Paths } from "expo-file-system";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, UrlTile } from "react-native-maps";
import {
  CENTRO_INICIAL,
  colorDe,
  deudaTotal,
  MapaClientesProps,
  titulo,
} from "./mapaClientes.types";

// Mapa de OpenStreetMap con sus cuadros guardados en el teléfono: sin señal se ven los que ya se cargaron antes
// (no se descargan zonas completas por adelantado).
const CARPETA_TILES = (() => {
  try { return `${Paths.cache.uri.replace(/\/?$/, "/")}tiles`; } catch { return undefined; }
})();

export default function MapaClientes({
  ubicaciones,
  onPressCliente,
  trazarRuta,
  trazado,
  seleccionId,
  onPressUbicacion,
  miUbicacion,
  estilo,
  posicion,
  seguirme,
  navegacion,
  onDejarDeSeguir,
  norte,
}: MapaClientesProps) {
  const mapRef = useRef<MapView>(null);
  const [enLinea, setEnLinea] = useState(hayConexion());
  useEffect(() => alCambiarConexion(setEnLinea), []);
  const siguiendo = !!seguirme && !!navegacion;

  // Seguirme: la cámara va a mi posición, gira según mi rumbo, algo inclinada y a zoom de calle
  useEffect(() => {
    if (!siguiendo || !mapRef.current || !navegacion) return;
    mapRef.current.animateCamera(
      { center: { latitude: navegacion.latitud, longitude: navegacion.longitud }, heading: navegacion.rumbo ?? 0, pitch: 45, zoom: 17 },
      { duration: 800 },
    );
  }, [siguiendo, navegacion]);

  // Botón "Norte": vuelve a mirar al norte y sin inclinación
  useEffect(() => {
    if (!norte || !mapRef.current) return;
    mapRef.current.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  }, [norte]);

  // Encuadra el mapa para que se vean todos los puntos guardados
  const encuadrar = useCallback(() => {
    if (!mapRef.current || !ubicaciones.length) return;
    if (ubicaciones.length === 1) {
      const u = ubicaciones[0];
      mapRef.current.animateToRegion(
        {
          latitude: u.latitud,
          longitude: u.longitud,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        },
        400,
      );
      return;
    }
    mapRef.current.fitToCoordinates(
      ubicaciones.map((u) => ({ latitude: u.latitud, longitude: u.longitud })),
      { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: true },
    );
  }, [ubicaciones]);

  // Los datos llegan después de que el mapa está listo: se encuadra al cambiar
  useEffect(() => {
    if (!siguiendo) encuadrar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuadrar]);

  // Centra el mapa en el punto seleccionado
  useEffect(() => {
    const u = ubicaciones.find((x) => x.id === seleccionId);
    if (!u || !mapRef.current || siguiendo) return;
    mapRef.current.animateToRegion(
      { latitude: u.latitud, longitude: u.longitud, latitudeDelta: 0.006, longitudeDelta: 0.006 },
      300,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seleccionId]);

  return (
    <MapView
      ref={mapRef}
      style={styles.map}
      mapType={Platform.OS === "android" ? "none" : "standard"}
      initialRegion={{
        latitude: CENTRO_INICIAL.latitud,
        longitude: CENTRO_INICIAL.longitud,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
      onMapReady={siguiendo ? undefined : encuadrar}
      showsUserLocation={!!miUbicacion && !siguiendo}
      onPanDrag={siguiendo ? () => onDejarDeSeguir?.() : undefined}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      onLongPress={(e) => {
        const c = e.nativeEvent.coordinate;
        Alert.alert(
          "Punto seleccionado",
          `Lat: ${c.latitude.toFixed(5)}, Lng: ${c.longitude.toFixed(5)}`,
        );
      }}
    >
      <UrlTile
        urlTemplate="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maximumZ={19}
        tileCachePath={CARPETA_TILES}
        tileCacheMaxAge={60 * 60 * 24 * 30}
        offlineMode={!enLinea}
        shouldReplaceMapContent
        zIndex={-1}
      />
      {trazarRuta && ((trazado?.length ?? 0) > 1 || ubicaciones.length > 1) && (
        <Polyline
          coordinates={(trazado && trazado.length > 1 ? trazado : ubicaciones).map((u) => ({ latitude: u.latitud, longitude: u.longitud }))}
          strokeColor={Palette.navy}
          strokeWidth={3}
        />
      )}
      {posicion && (
        <Marker coordinate={{ latitude: posicion.latitud, longitude: posicion.longitud }} anchor={{ x: 0.5, y: 0.5 }} title={posicion.titulo ?? "Posición"} zIndex={20}>
          <View style={styles.yo} />
        </Marker>
      )}
      {/* Seguirme: flecha que apunta hacia donde miro / avanzo (gira con el mapa) */}
      {siguiendo && navegacion && (
        <Marker coordinate={{ latitude: navegacion.latitud, longitude: navegacion.longitud }} anchor={{ x: 0.5, y: 0.5 }}
          flat rotation={navegacion.rumbo ?? 0} zIndex={30} tracksViewChanges={false} title="Tú estás aquí">
          <View style={styles.flecha}>
            <Ionicons name="navigate" size={20} color="#FFFFFF" style={{ transform: [{ rotate: "-45deg" }] }} />
          </View>
        </Marker>
      )}
      {ubicaciones.map((u) => {
        const deuda = deudaTotal(u);
        const nombres = u.clientes
          .map((c) => (c.deuda > 0 ? `${c.nombre} (debe ${clp(c.deuda)})` : c.nombre))
          .join("\n");
        return (
          <Marker
            key={u.id}
            coordinate={{ latitude: u.latitud, longitude: u.longitud }}
            onPress={onPressUbicacion ? () => onPressUbicacion(u) : undefined}
            zIndex={u.id === seleccionId ? 10 : 1}
            pinColor={u.etiqueta || estilo === "punto" ? undefined : colorDe(u, Palette.green, Palette.amber)}
            anchor={estilo === "punto" ? { x: 0.5, y: 0.5 } : undefined}
            tracksViewChanges={estilo !== "punto"}
            title={titulo(u)}
            description={
              u.clientes.length === 1
                ? `${u.direccion} · ${deuda > 0 ? `Debe ${clp(deuda)}` : "Al día"}`
                : `${u.direccion}\n${nombres}`
            }
            // Tocar la burbuja abre la ficha del cliente (si hay uno solo en esa casa)
            onCalloutPress={
              u.clientes.length === 1 && onPressCliente
                ? () => onPressCliente(u.clientes[0].id)
                : undefined
            }
          >
            {estilo === "punto" && !u.etiqueta ? (
              <View style={[styles.punto, { backgroundColor: colorDe(u, Palette.green, Palette.yellow), borderColor: deuda > 0 ? Palette.yellowBorder : "#FFFFFF" }]} />
            ) : u.etiqueta ? (
              <View style={[styles.numero, { backgroundColor: colorDe(u, Palette.green, Palette.amber) }, u.id === seleccionId && styles.numeroSel]}>
                <Text style={styles.numeroText}>{u.etiqueta}</Text>
              </View>
            ) : null}
          </Marker>
        );
      })}
    </MapView>
  );
}

const styles = StyleSheet.create({
  map: { width: "100%", height: "100%" },
  numero: { minWidth: 28, height: 28, borderRadius: 14, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#FFFFFF" },
  numeroText: { color: "#FFFFFF", fontWeight: "800", fontSize: 13 },
  punto: { width: 16, height: 16, borderRadius: 8, borderWidth: 2 },
  yo: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#2F80ED", borderWidth: 3, borderColor: "#FFFFFF" },
  flecha: { width: 34, height: 34, borderRadius: 17, backgroundColor: "#2F80ED", borderWidth: 3, borderColor: "#FFFFFF", alignItems: "center", justifyContent: "center" },
  numeroSel: { minWidth: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: Palette.orange },
});
