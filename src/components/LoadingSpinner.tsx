import { ActivityIndicator, StyleSheet, View, Text } from 'react-native';
import { AppColors } from '@/constants/theme';

interface Props {
  visible?: boolean;
  text?: string;
  size?: 'small' | 'large';
  color?: string;
}

export const LoadingSpinner = ({
  visible = true,
  text = 'Loading...',
  size = 'large',
  color = AppColors.accent
}: Props) => {
  if (!visible) return null;

  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={color} />
      {text && <Text style={styles.text}>{text}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: AppColors.background,
  },
  text: {
    marginTop: 12,
    color: AppColors.textSecondary,
    fontSize: 16,
  },
});