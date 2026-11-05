import { ActivityIndicator, Text, View } from 'react-native';
import { AuthBrand } from '@/components/auth-brand';
import { AppColors } from '@/constants/theme';

export function AppLoadingScreen() {
  return (
    <View style={{ flex: 1, backgroundColor: AppColors.background, alignItems: 'center', justifyContent: 'center', paddingTop: 24, gap: 14 }}>
      <AuthBrand />
      <Text style={{ color: AppColors.textSecondary, fontSize: 12, letterSpacing: 1 }}>By SNAP</Text>
      <ActivityIndicator accessibilityLabel="Opening RoomScout" color={AppColors.accent} style={{ marginTop: 14 }} />
    </View>
  );
}
