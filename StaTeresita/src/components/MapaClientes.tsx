// Mapa de clientes para iOS / Android (react-native-maps).
// Basado en el mapa de kaffee000 (github.com/kaffee000/StaTeresita).
// La versión web está en MapaClientes.web.tsx (Metro elige el archivo según la plataforma).

import { Palette } from "@/constants/palette";
import { clp } from "@/lib/format";
import { useCallback, useEffect, useRef } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import {
  CENTRO_INICIAL,
  colorDe,
  deudaTotal,
  MapaClientesProps,
  titulo,
} from "./mapaClientes.types";

export default function MapaClientes({
  ubicaciones,
  onPressCliente,
  trazarRuta,
  trazado,
  seleccionId,
  onPressUbicacion,
  miUbicacion,
  onPressMapa,
}: MapaClientesProps) {
  const mapRef = useRef<MapView>(null);

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
    encuadrar();
  }, [encuadrar]);

  // Centra el mapa en el punto seleccionado
  useEffect(() => {
    const u = ubicaciones.find((x) => x.id === seleccionId);
    if (!u || !mapRef.current) return;
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
      initialRegion={{
        latitude: CENTRO_INICIAL.latitud,
        longitude: CENTRO_INICIAL.longitud,
        latitudeDelta: 0.05,
        longitudeDelta: 0.05,
      }}
      onMapReady={encuadrar}
      showsUserLocation={!!miUbicacion && !onPressMapa}
      onPress={onPressMapa ? (e) => {
        // Los toques sobre un marcador no cuentan como toque en el mapa
        if ((e.nativeEvent as any).action === "marker-press") return;
        onPressMapa({ latitud: e.nativeEvent.coordinate.latitude, longitud: e.nativeEvent.coordinate.longitude });
      } : undefined}
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
      {trazarRuta && ((trazado?.length ?? 0) > 1 || ubicaciones.length > 1) && (
        <Polyline
          coordinates={(trazado && trazado.length > 1 ? trazado : ubicaciones).map((u) => ({ latitude: u.latitud, longitude: u.longitud }))}
          strokeColor={Palette.navy}
          strokeWidth={3}
        />
      )}
      {/* Ubicación simulada: el punto azul propio (el del GPS no sirve porque no es la posición real) */}
      {onPressMapa && miUbicacion && (
        <Marker coordinate={{ latitude: miUbicacion.latitud, longitude: miUbicacion.longitud }} anchor={{ x: 0.5, y: 0.5 }} title="Tú estás aquí (simulado)">
          <View style={styles.yo} />
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
            pinColor={u.etiqueta ? undefined : colorDe(u, Palette.green, Palette.amber)}
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
            {u.etiqueta ? (
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
  yo: { width: 18, height: 18, borderRadius: 9, backgroundColor: "#2F80ED", borderWidth: 3, borderColor: "#FFFFFF" },
  numeroSel: { minWidth: 38, height: 38, borderRadius: 19, borderWidth: 3, borderColor: Palette.orange },
});
