import '@/global.css';

import { Platform } from 'react-native';

/** Minimalist dark blue / black / white palette */
export const AppColors = {
  background: '#0A0F1A',
  surface: '#111827',
  surfaceElevated: '#1A2332',
  border: '#1E3A5F',
  borderSubtle: '#1F2937',
  text: '#FFFFFF',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  accent: '#3B82F6',
  accentMuted: '#2563EB',
  success: '#34D399',
  successBg: '#064E3B',
  error: '#F87171',
  errorBg: '#450A0A',
  warning: '#FBBF24',
  warningBg: '#451A03',
  tabBar: '#0A0F1A',
  tabBarBorder: '#1E3A5F',
  input: '#1A2332',
  inputBorder: '#2D3748',
  overlay: 'rgba(10, 15, 26, 0.92)',
  white: '#FFFFFF',
  black: '#000000',
} as const;

export const Colors = {
  light: {
    text: AppColors.text,
    background: AppColors.background,
    backgroundElement: AppColors.surface,
    backgroundSelected: AppColors.surfaceElevated,
    textSecondary: AppColors.textSecondary,
  },
  dark: {
    text: AppColors.text,
    background: AppColors.background,
    backgroundElement: AppColors.surface,
    backgroundSelected: AppColors.surfaceElevated,
    textSecondary: AppColors.textSecondary,
  },
} as const;

export type ThemeColor = keyof typeof Colors.light & keyof typeof Colors.dark;

export const Fonts = Platform.select({
  ios: {
    sans: 'system-ui',
    serif: 'ui-serif',
    rounded: 'ui-rounded',
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: 'var(--font-display)',
    serif: 'var(--font-serif)',
    rounded: 'var(--font-rounded)',
    mono: 'var(--font-mono)',
  },
});

export const Spacing = {
  half: 2,
  one: 4,
  two: 8,
  three: 16,
  four: 24,
  five: 32,
  six: 64,
} as const;

export const BottomTabInset = Platform.select({ ios: 50, android: 80 }) ?? 0;
export const MaxContentWidth = 800;

export const BorderRadius = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
  full: 9999,
} as const;
