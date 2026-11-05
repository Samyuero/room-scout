import { ErrorToast, ErrorToastProvider } from '@/components/error-toast';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { DiscoveryProvider } from '@/context/discovery-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NotificationProvider } from '@/context/notification-context';
import { Text, View } from 'react-native';
import { isSupabaseConfigured, supabaseConfigurationMessage } from '@/lib/supabase';

export default function RootLayout() {
  if (!isSupabaseConfigured) {
    return <View style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 14, backgroundColor: AppColors.background }}>
      <StatusBar style="light" />
      <Text style={{ color: AppColors.text, fontSize: 22, fontWeight: '700' }}>This test build needs setup</Text>
      <Text selectable style={{ color: AppColors.textSecondary, fontSize: 15, lineHeight: 23 }}>{supabaseConfigurationMessage}</Text>
      <Text style={{ color: AppColors.textMuted, fontSize: 13 }}>Please install a corrected RoomScout test APK from SNAP.</Text>
    </View>;
  }
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <SafeAreaProvider>
      <ErrorToastProvider>
      <DiscoveryProvider>
      <NotificationProvider>
        <StatusBar style="light" />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: AppColors.background },
            headerStyle: { backgroundColor: AppColors.surface },
            headerTintColor: AppColors.text,
            headerTitleStyle: { color: AppColors.text },
          }}
        >
          <Stack.Screen name="index" options={{ headerShown: false }} />
          <Stack.Screen name="(auth)" options={{ headerShown: false }} />
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="chat" options={{ headerShown: true, title: 'Dorm Assistant' }} />
          <Stack.Screen name="add-dorm" options={{ presentation: 'modal', title: 'Add Dormitory', headerShown: true }} />
          <Stack.Screen name="admin" options={{ headerShown: true, title: 'Admin Dashboard' }} />
          <Stack.Screen name="owner-panel" options={{ headerShown: true, title: 'Owner Dashboard' }} />
          <Stack.Screen name="view-id" options={{ headerShown: false, gestureEnabled: false }} />
          <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Notifications' }} />
        </Stack>
        <ErrorToast />
      </NotificationProvider>
      </DiscoveryProvider>
      </ErrorToastProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
