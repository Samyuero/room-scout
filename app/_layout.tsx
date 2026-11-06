import { ErrorToast, ErrorToastProvider } from '@/components/error-toast';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { DiscoveryProvider } from '@/context/discovery-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NotificationProvider } from '@/context/notification-context';
import { Text, View } from 'react-native';
import { isSupabaseConfigured, supabaseConfigurationMessage } from '@/lib/supabase';

function AppNavigation() {
  const insets = useSafeAreaInsets();
  return <Stack screenOptions={{
    headerShown: false,
    contentStyle: { backgroundColor: AppColors.background },
    headerStyle: { backgroundColor: AppColors.surface },
    headerTintColor: AppColors.text,
    headerTitleStyle: { color: AppColors.text },
  }}>
    <Stack.Screen name="index" options={{ contentStyle: { backgroundColor: AppColors.background } }} />
    <Stack.Screen name="(auth)" options={{ contentStyle: { backgroundColor: AppColors.background } }} />
    {/* The tab bar already consumes the bottom system inset. */}
    <Stack.Screen name="(tabs)" options={{ contentStyle: { backgroundColor: AppColors.background } }} />
    <Stack.Screen name="chat" options={{ headerShown: true, title: 'Dorm Assistant' }} />
    <Stack.Screen name="add-dorm" options={{ presentation: 'modal', title: 'Dormitory', headerShown: true, contentStyle: { backgroundColor: AppColors.background, paddingBottom: insets.bottom } }} />
    <Stack.Screen name="admin" options={{ headerShown: true, title: 'Admin Dashboard' }} />
    <Stack.Screen name="admin-document" options={{ headerShown: true, title: 'Protected document' }} />
    <Stack.Screen name="owner-panel" options={{ headerShown: true, title: 'Owner Dashboard' }} />
    <Stack.Screen name="booking-history" options={{ headerShown: true, title: 'Bookings & history' }} />
    <Stack.Screen name="tenant-history" options={{ headerShown: true, title: 'Past tenants' }} />
    <Stack.Screen name="support" options={{ headerShown: true, title: 'Help & my tickets' }} />
    <Stack.Screen name="support-ticket" options={{ headerShown: true, title: 'Support ticket' }} />
    <Stack.Screen name="view-id" options={{ gestureEnabled: false }} />
    <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Notifications' }} />
  </Stack>;
}

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
        <AppNavigation />
        <ErrorToast />
      </NotificationProvider>
      </DiscoveryProvider>
      </ErrorToastProvider>
    </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
