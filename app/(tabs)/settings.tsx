import { useState } from 'react';
import { View, Text, Switch as RNSwitch, StyleSheet, Pressable, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppColors, BorderRadius } from '@/constants/theme';

export default function Settings() {
  const insets = useSafeAreaInsets();
  const [theme, setTheme] = useState('dark');
  const [locationEnabled, setLocationEnabled] = useState(true);
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [pushNotifications, setPushNotifications] = useState(true);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top }]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.pageHeader}>
        <Text style={styles.pageTitle}>Settings</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <SettingsItem title="Profile" onPress={() => {}} right={() => <Chevron />} />
        <SettingsItem title="Payment Methods" onPress={() => {}} right={() => <Chevron />} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Preferences</Text>
        <SettingsItem
          title="Theme"
          value={theme.charAt(0).toUpperCase() + theme.slice(1)}
          onPress={() => {
            const next = theme === 'dark' ? 'light' : 'dark';
            setTheme(next);
          }}
          right={() => <Chevron />}
        />
        <SettingsItem title="Distance Unit" value="Kilometers" onPress={() => {}} right={() => <Chevron />} />
        <SettingsItem title="Currency" value="Philippine Peso (₱)" onPress={() => {}} right={() => <Chevron />} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <SettingsItem
          title="Push Notifications"
          right={() => (
            <RNSwitch
              value={pushNotifications}
              onValueChange={setPushNotifications}
              trackColor={{ false: AppColors.inputBorder, true: AppColors.accentMuted }}
              thumbColor={AppColors.white}
            />
          )}
        />
        <SettingsItem
          title="Email Notifications"
          right={() => (
            <RNSwitch
              value={emailNotifications}
              onValueChange={setEmailNotifications}
              trackColor={{ false: AppColors.inputBorder, true: AppColors.accentMuted }}
              thumbColor={AppColors.white}
            />
          )}
        />
        <SettingsItem
          title="Location Alerts"
          right={() => (
            <RNSwitch
              value={locationEnabled}
              onValueChange={setLocationEnabled}
              trackColor={{ false: AppColors.inputBorder, true: AppColors.accentMuted }}
              thumbColor={AppColors.white}
            />
          )}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Privacy & Security</Text>
        <SettingsItem title="Privacy Policy" onPress={() => {}} right={() => <Chevron />} />
        <SettingsItem title="Terms of Service" onPress={() => {}} right={() => <Chevron />} />
        <SettingsItem title="Change Password" onPress={() => {}} right={() => <Chevron />} />
        <SettingsItem title="Data & Storage" onPress={() => {}} right={() => <Chevron />} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>About</Text>
        <SettingsItem title="About SNAP" onPress={() => {}} right={() => <Chevron />} />
        <SettingsItem title="Version" value="1.0.0" />
      </View>
    </ScrollView>
  );
}

function Chevron() {
  return <Text style={styles.arrow}>›</Text>;
}

function SettingsItem({
  title,
  value,
  onPress,
  right,
}: {
  title: string;
  value?: string;
  onPress?: () => void;
  right?: () => React.ReactNode;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.settingsItem, pressed && onPress && styles.settingsItemPressed]}
      onPress={onPress}
      disabled={!onPress}
    >
      <View style={styles.settingsItemLeft}>
        <Text style={styles.settingsItemTitle}>{title}</Text>
      </View>
      <View style={styles.settingsItemRight}>
        {value ? <Text style={styles.settingsItemValue}>{value}</Text> : null}
        {right ? right() : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 40,
  },
  pageHeader: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 20,
  },
  pageTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: AppColors.text,
    letterSpacing: -0.5,
  },
  section: {
    marginBottom: 24,
    marginHorizontal: 16,
    backgroundColor: AppColors.surface,
    borderRadius: BorderRadius.lg,
    borderWidth: 1,
    borderColor: AppColors.borderSubtle,
    overflow: 'hidden',
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
    color: AppColors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  arrow: {
    color: AppColors.textMuted,
    fontSize: 20,
    fontWeight: '300',
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AppColors.borderSubtle,
  },
  settingsItemPressed: {
    backgroundColor: AppColors.surfaceElevated,
  },
  settingsItemLeft: {
    flex: 1,
  },
  settingsItemTitle: {
    fontSize: 16,
    color: AppColors.text,
  },
  settingsItemRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  settingsItemValue: {
    fontSize: 15,
    color: AppColors.textMuted,
  },
});
