import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { usePathname, useRouter } from 'expo-router';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { ReduceMotion, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';

const SIZE = 52;
let introShownThisSession = false;
const INTRO_SEEN_KEY = 'roomscout_snap_intro_seen_v1';

export function DormAssistantFab() {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [showIntro, setShowIntro] = useState(false);
  const [hidden, setHidden] = useState(false);
  const x = useSharedValue(14);
  const y = useSharedValue(Math.max(80, height - insets.bottom - 150));
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);

  useEffect(() => {
    x.set(Math.min(Math.max(8, x.get()), Math.max(8, width - SIZE - 8)));
    y.set(Math.min(Math.max(insets.top + 8, y.get()), Math.max(insets.top + 8, height - insets.bottom - 118)));
  }, [height, insets.bottom, insets.top, width, x, y]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!pathname.endsWith('/home') || introShownThisSession) { setShowIntro(false); return; }
    void AsyncStorage.getItem(INTRO_SEEN_KEY).then((seen) => {
      if (!active || seen || introShownThisSession) return;
      introShownThisSession = true;
      setShowIntro(true);
      void AsyncStorage.setItem(INTRO_SEEN_KEY, 'true');
      timer = setTimeout(() => { if (active) setShowIntro(false); }, 5000);
    });
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [pathname]);

  const pan = useMemo(() => Gesture.Pan()
    .minDistance(8)
    .onStart(() => {
      startX.set(x.get());
      startY.set(y.get());
    })
    .onUpdate((event) => {
      x.set(Math.min(Math.max(8, startX.get() + event.translationX), Math.max(8, width - SIZE - 8)));
      y.set(Math.min(Math.max(insets.top + 8, startY.get() + event.translationY), Math.max(insets.top + 8, height - insets.bottom - 118)));
    })
    .onEnd((event) => {
      const snapX = x.get() + SIZE / 2 < width / 2 ? 12 : width - SIZE - 12;
      x.set(withSpring(snapX, { duration: 400, dampingRatio: 0.8, velocity: event.velocityX, reduceMotion: ReduceMotion.System }));
    }), [height, insets.bottom, insets.top, startX, startY, width, x, y]);

  const positionStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }, { translateY: y.get() }] }));

  if (hidden) return null;

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <GestureDetector gesture={pan}>
        <Animated.View style={[styles.position, positionStyle]}>
          {showIntro && <View style={styles.intro}><Text style={styles.introText}>Hi, I am SNAP, your personal dormitory assistant!</Text><Pressable accessibilityLabel="Dismiss assistant introduction" onPress={() => setShowIntro(false)} hitSlop={8}><Ionicons name="close" size={16} color={AppColors.textSecondary} /></Pressable></View>}
          <Pressable accessibilityRole="button" accessibilityLabel="Open SNAP dorm assistant. Drag to move." accessibilityHint="Long press to hide this button until the app restarts." hitSlop={8} onLongPress={() => setHidden(true)} onPress={() => router.push('/chat')} style={({ pressed }) => [styles.icon, pressed && styles.pressed]}>
            <MaterialCommunityIcons name="robot-happy-outline" size={26} color={AppColors.white} />
          </Pressable>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  position: { position: 'absolute', left: 0, top: 0, width: SIZE, height: SIZE, zIndex: 30 },
  icon: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderCurve: 'continuous', backgroundColor: AppColors.accent, borderWidth: 2, borderColor: AppColors.white, boxShadow: '0 8px 22px rgba(0,0,0,0.3)' },
  pressed: { opacity: 0.78 },
  intro: { position: 'absolute', left: SIZE + 8, bottom: 4, width: 220, flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderCurve: 'continuous', backgroundColor: AppColors.surfaceElevated, borderWidth: 1, borderColor: AppColors.border },
  introText: { flex: 1, color: AppColors.text, fontSize: 11, lineHeight: 16, fontWeight: '700' },
});
