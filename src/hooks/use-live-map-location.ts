import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as Location from 'expo-location';
import type { UserCoordinates } from '../types/dorm';

/** Map-only foreground GPS. Never stores or uploads a location trail. */
export function useLiveMapLocation(seed: UserCoordinates | null) {
  const [position, setPosition] = useState<UserCoordinates | null>(seed);
  const [tracking, setTracking] = useState(false);
  const [message, setMessage] = useState('');
  useFocusEffect(useCallback(() => {
    setPosition(seed);
    let disposed = false;
    let generation = 0;
    let subscription: Location.LocationSubscription | null = null;
    let staleTimer: ReturnType<typeof setTimeout> | undefined;
    function stop() { generation++; clearTimeout(staleTimer); subscription?.remove(); subscription = null; setTracking(false); }
    async function start() {
      stop(); const run = generation;
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (disposed || run !== generation) return;
        if (permission.status !== 'granted') { setMessage('Tap Locate me to enable live location.'); return; }
        const enabled = await Location.hasServicesEnabledAsync();
        if (disposed || run !== generation) return;
        if (!enabled) { setMessage('GPS is off. Your last position is not live.'); return; }
        const next = await Location.watchPositionAsync({ accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000, mayShowUserSettingsDialog: false }, (fix) => {
          if (disposed || run !== generation) return;
          const { latitude, longitude, accuracy } = fix.coords;
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180 || !Number.isFinite(fix.timestamp) || Date.now()-fix.timestamp>30000 || !Number.isFinite(accuracy) || accuracy === null || accuracy<0 || accuracy>100) {
            setTracking(false); setMessage('Waiting for a more accurate GPS position…'); return;
          }
          setPosition({ latitude, longitude, accuracy_m: accuracy }); setTracking(true); setMessage('');
          clearTimeout(staleTimer);
          staleTimer = setTimeout(() => { if (!disposed && run === generation) { setTracking(false); setMessage('Waiting for a fresh GPS position…'); } }, 30000);
        }, () => { if (!disposed && run === generation) { setTracking(false); setMessage('Live GPS is unavailable. Tap Locate me to retry.'); } });
        if (disposed || run !== generation) next.remove(); else subscription = next;
      } catch { if (!disposed && run === generation) { setTracking(false); setMessage('Live GPS is unavailable. Tap Locate me to retry.'); } }
    }
    if (AppState.currentState === 'active') void start();
    const listener = AppState.addEventListener('change', (state) => { if (state === 'active') void start(); else stop(); });
    return () => { disposed = true; stop(); listener.remove(); };
  }, [seed]));
  return { position, tracking, message };
}
