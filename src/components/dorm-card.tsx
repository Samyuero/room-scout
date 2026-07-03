import { Image, View, TouchableOpacity, StyleSheet, ImageProps } from 'react-native';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Dorm } from '@/types/dorm';

type Props = {
  dorm: Dorm;
  onPress: () => void;
};

export function DormCard({ dorm, onPress }: Props) {
  // Handle case where images might be null, undefined, not an array, empty, or contain invalid first element
  const imageUrl =
    Array.isArray(dorm.images) &&
    dorm.images.length > 0 &&
    typeof dorm.images[0] === 'string' &&
    dorm.images[0].length > 0
      ? dorm.images[0]
      : 'https://via.placeholder.com/200x300?text=No+Image';

  return (
    <ThemedView type="background" style={styles.card}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.8}>
        <Image
          source={{ uri: imageUrl }}
          style={styles.image}
          resizeMode="cover"
        />
        <ThemedView style={styles.content}>
          <ThemedText type="title" themeColor="text">
            {dorm.name}
          </ThemedText>
          <ThemedText type="small" themeColor="text">
            {dorm.address}
          </ThemedText>
          <ThemedText type="smallBold" themeColor="text">
            ${dorm.price}/month
          </ThemedText>
        </ThemedView>
      </TouchableOpacity>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    overflow: 'hidden',
    marginBottom: 16,
    elevation: 3,
  },
  image: {
    width: '100%',
    height: 180,
  },
  content: {
    padding: 16,
  },
});