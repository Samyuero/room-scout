import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
  TextInput,
  Platform,
  Linking,
  Alert,
} from 'react-native';
import { Callout } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../../src/lib/supabase';
import * as Location from 'expo-location';
import { OsmMapView, Marker } from '@/components/OsmMapView';
import { UCLM_COORDINATES } from '@/constants/map';
import { AppColors, BorderRadius } from '@/constants/theme';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const [dorms, setDorms] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDorm, setSelectedDorm] = useState<any | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [region, setRegion] = useState({ ...UCLM_COORDINATES });

  const fetchDorms = async () => {
    try {
      const { data, error } = await supabase.from('dorms').select('*');
      if (error) throw error;
      setDorms(data || []);
    } catch (error) {
      console.error('Error fetching dorms:', error);
    } finally {
      setLoading(false);
    }
  };

  const getUserLocation = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setRegion({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      });
    } catch (err) {
      console.error('Error getting location:', err);
    }
  };

  useEffect(() => {
    fetchDorms();
    getUserLocation();
  }, []);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=1`,
        { headers: { 'User-Agent': 'RoomScoutApp/1.0' } }
      );
      const data = await response.json();

      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        setRegion({
          latitude: lat,
          longitude: lon,
          latitudeDelta: 0.01,
          longitudeDelta: 0.01,
        });
      } else {
        Alert.alert('No Results', 'Location not found. Try adding city details or postal codes.');
      }
    } catch (err) {
      console.error('Error geocoding:', err);
      Alert.alert('Error', 'Failed to search location.');
    } finally {
      setSearching(false);
    }
  };

  const handleDirections = (dorm: any) => {
    const lat = dorm.latitude;
    const lon = dorm.longitude;
    const url = Platform.select({
      ios: `maps://app?daddr=${lat},${lon}`,
      android: `google.navigation:q=${lat},${lon}`,
    });

    if (url) {
      Linking.canOpenURL(url).then((supported) => {
        if (supported) {
          Linking.openURL(url);
        } else {
          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`);
        }
      });
    }
  };

  const validDorms = dorms.filter(
    (d) => typeof d.latitude === 'number' && typeof d.longitude === 'number'
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={AppColors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <OsmMapView
        style={styles.map}
        region={region}
        onRegionChangeComplete={setRegion}
      >
        {validDorms.map((dorm) => (
          <Marker
            key={dorm.dorm_id}
            coordinate={{ latitude: dorm.latitude, longitude: dorm.longitude }}
            title={dorm.name}
            description={`₱${dorm.price}/month`}
            pinColor={AppColors.accent}
            onPress={() => setSelectedDorm(dorm)}
          >
            {selectedDorm?.dorm_id === dorm.dorm_id ? (
              <Callout tooltip style={styles.calloutWrapper}>
                <View style={styles.calloutContainer}>
                  <Text style={styles.calloutTitle}>{dorm.name}</Text>
                  <Text style={styles.calloutPrice}>₱{dorm.price}/month</Text>
                  <Text style={styles.calloutAddress}>{dorm.address}</Text>
                  <Pressable
                    style={styles.directionsBtn}
                    onPress={() => handleDirections(dorm)}
                  >
                    <Text style={styles.btnText}>Directions</Text>
                  </Pressable>
                </View>
              </Callout>
            ) : null}
          </Marker>
        ))}
      </OsmMapView>

      <View style={[styles.searchContainer, { top: insets.top + 12 }]}>
        <TextInput
          placeholder="Search location..."
          value={searchQuery}
          onChangeText={setSearchQuery}
          onSubmitEditing={handleSearch}
          style={styles.searchInput}
          placeholderTextColor={AppColors.textMuted}
        />
        <Pressable style={styles.searchButton} onPress={handleSearch}>
          {searching ? (
            <ActivityIndicator size="small" color={AppColors.white} />
          ) : (
            <Text style={styles.searchButtonText}>Go</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  map: {
    flex: 1,
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.background,
  },
  searchContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: AppColors.overlay,
    borderRadius: BorderRadius.md,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  searchInput: {
    flex: 1,
    height: 48,
    fontSize: 16,
    color: AppColors.text,
  },
  searchButton: {
    backgroundColor: AppColors.accent,
    borderRadius: BorderRadius.sm,
    paddingVertical: 8,
    paddingHorizontal: 16,
    marginLeft: 8,
  },
  searchButtonText: {
    color: AppColors.white,
    fontWeight: '700',
  },
  calloutWrapper: {
    width: 220,
    backgroundColor: 'transparent',
  },
  calloutContainer: {
    backgroundColor: AppColors.surfaceElevated,
    borderRadius: BorderRadius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  calloutTitle: {
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
    color: AppColors.text,
  },
  calloutPrice: {
    fontSize: 14,
    color: AppColors.success,
    fontWeight: '600',
    marginBottom: 4,
  },
  calloutAddress: {
    fontSize: 12,
    color: AppColors.textSecondary,
    marginBottom: 8,
  },
  directionsBtn: {
    paddingVertical: 8,
    borderRadius: BorderRadius.sm,
    alignItems: 'center',
    backgroundColor: AppColors.accent,
    marginTop: 4,
  },
  btnText: {
    color: AppColors.white,
    fontSize: 12,
    fontWeight: '700',
  },
});
