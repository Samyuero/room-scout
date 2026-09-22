import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { AppColors } from '@/constants/theme';

export function DormAssistantFab() {
  const router = useRouter();
  const [visible, setVisible] = useState(true);
  if (!visible) return null;

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <View style={styles.bubble}>
        <Pressable accessibilityLabel="Close dorm assistant shortcut" hitSlop={8} onPress={() => setVisible(false)} style={styles.close}>
          <Ionicons name="close" size={13} color={AppColors.textSecondary} />
        </Pressable>
        <Pressable accessibilityLabel="Open dorm assistant" onPress={() => router.push('/chat')} style={styles.action}>
          <View style={styles.icon}><Ionicons name="sparkles" size={18} color={AppColors.white} /></View>
          <View><Text style={styles.title}>Dorm Assistant</Text><Text style={styles.subtitle}>Ask for a place</Text></View>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 14, bottom: 88, zIndex: 30 },
  bubble: { minWidth: 166, padding: 6, paddingRight: 22, borderRadius: 22, borderCurve: 'continuous', backgroundColor: AppColors.surfaceElevated, borderWidth: 1, borderColor: AppColors.border, boxShadow: '0 10px 28px rgba(0,0,0,0.32)' },
  close: { position: 'absolute', right: 5, top: 5, zIndex: 2, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: AppColors.surface },
  action: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingRight: 4 },
  icon: { width: 40, height: 40, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: AppColors.accent },
  title: { color: AppColors.text, fontSize: 12, fontWeight: '800' },
  subtitle: { color: AppColors.textMuted, fontSize: 9, paddingTop: 1 },
});
