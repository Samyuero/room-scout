import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  UrlTile,
  type MapViewProps,
  type Region,
} from 'react-native-maps';
import { MAP_TILE_URL } from '@/constants/map';

type OsmMapViewProps = Omit<MapViewProps, 'mapType'> & {
  style?: ViewStyle;
  region: Region;
};

function WebMapFallback({ region, style }: { region: Region; style?: ViewStyle }) {
  const lat = region.latitude;
  const lon = region.longitude;
  const delta = region.latitudeDelta || 0.015;
  const bbox = `${lon - delta},${lat - delta},${lon + delta},${lat + delta}`;
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${lat}%2C${lon}`;

  return (
    <View style={[styles.webContainer, style]}>
      {/* eslint-disable-next-line react/no-unknown-property */}
      <iframe
        title="Map"
        src={src}
        style={{ border: 0, width: '100%', height: '100%', borderRadius: 10 }}
        allowFullScreen
      />
    </View>
  );
}

export function OsmMapView({ style, region, children, ...props }: OsmMapViewProps) {
  if (Platform.OS === 'web') {
    return <WebMapFallback region={region} style={style} />;
  }

  return (
    <MapView
      {...props}
      style={[styles.map, style]}
      provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
      region={region}
      mapType="none"
      showsUserLocation
      userInterfaceStyle="dark"
    >
      <UrlTile
        urlTemplate={MAP_TILE_URL}
        maximumZ={19}
        tileSize={256}
        shouldReplaceMapContent={Platform.OS === 'ios'}
        zIndex={-1}
      />
      {children}
    </MapView>
  );
}

export { Marker };
export type { Region };

const styles = StyleSheet.create({
  map: {
    ...StyleSheet.absoluteFillObject,
  },
  webContainer: {
    flex: 1,
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: '#111827',
  },
});
