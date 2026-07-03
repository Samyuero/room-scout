import { View, Text, StyleSheet, Animated } from 'react-native';

interface Props {
  width?: number | string;
  height?: number | string;
  borderRadius?: number;
  count?: number;
  marginVertical?: number;
}

export const SkeletonLoader = ({
  width = '100%',
  height = 16,
  borderRadius = 4,
  count = 1,
  marginVertical = 8
}: Props) => {
  return (
    <View style={{ marginVertical }}>
      {[...Array(count)].map((_, index) => (
        <View key={index} style={[styles.item, { width: width as any, height: height as any, borderRadius }]} />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  item: {
    backgroundColor: '#e0e0e0',
    marginBottom: 8,
  },
});