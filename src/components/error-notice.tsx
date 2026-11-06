import { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { AppColors } from '@/constants/theme';

/** Inline validation feedback fades after three seconds; the form draft stays intact. */
export function ErrorNotice({ message, tone = 'error' }: { message: string | null; tone?: 'error' | 'warning' }) {
  const [opacity] = useState(() => new Animated.Value(1));
  const [visible, setVisible] = useState(Boolean(message));
  useEffect(() => {
    setVisible(Boolean(message));
    opacity.setValue(1);
    const timer = setTimeout(() => Animated.timing(opacity, { toValue: 0, duration: 250, useNativeDriver: true }).start(({ finished }) => { if (finished) setVisible(false); }), 3000);
    return () => { clearTimeout(timer); opacity.stopAnimation(); };
  }, [message, opacity]);
  if (!visible || !message) return null;
  return <Animated.View accessibilityRole="alert" accessibilityLiveRegion="polite" style={[styles.notice, tone === 'warning' && styles.warning, { opacity }]}><Text style={styles.text}>{message}</Text></Animated.View>;
}
const styles = StyleSheet.create({ notice: { margin: 12, padding: 12, borderRadius: 8, backgroundColor: AppColors.errorBg }, warning: { backgroundColor: AppColors.warningBg, borderWidth: 1, borderColor: AppColors.warning }, text: { color: AppColors.text, fontSize: 13, lineHeight: 18 } });
