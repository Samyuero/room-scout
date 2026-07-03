import Constants from 'expo-constants';
import { Platform, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import MapView, {
  Marker,
  PROVIDER_GOOGLE,
  UrlTile,
  type MapViewProps,
  type Region,
} from 'react-native-maps';
import { MAP_TILE_URL } from '@/constants/map';
import { AppColors, BorderRadius } from '@/constants/theme';

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

function NativeMapUnavailable({ style }: { style?: ViewStyle }) {
  return (
    <View style={[styles.unavailableContainer, style]}>
      <View style={styles.unavailablePanel}>
        <Text style={styles.unavailableTitle}>Map unavailable</Text>
        <Text style={styles.unavailableText}>
          This Android build was created without a Google Maps API key. Add a key and rebuild the
          APK to enable the map.
        </Text>
      </View>
    </View>
  );
}

export function OsmMapView({ style, region, children, ...props }: OsmMapViewProps) {
  if (Platform.OS === 'web') {
    return <WebMapFallback region={region} style={style} />;
  }

  const hasGoogleMapsApiKey = Boolean(Constants.expoConfig?.extra?.hasGoogleMapsApiKey);

  if (Platform.OS === 'android' && !hasGoogleMapsApiKey) {
    return <NativeMapUnavailable style={style} />;
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
  unavailableContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    backgroundColor: AppColors.surface,
  },
  unavailablePanel: {
    width: '100%',
    maxWidth: 360,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: BorderRadius.md,
    padding: 16,
    backgroundColor: AppColors.surfaceElevated,
  },
  unavailableTitle: {
    marginBottom: 8,
    color: AppColors.text,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  unavailableText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
});
