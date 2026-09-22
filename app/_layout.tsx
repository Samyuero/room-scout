import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppColors } from '@/constants/theme';
import { DiscoveryProvider } from '@/context/discovery-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DiscoveryProvider>
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
          <Stack.Screen name="notifications" options={{ headerShown: true, title: 'Notifications' }} />
        </Stack>
      </DiscoveryProvider>
    </SafeAreaProvider>
  );
}
