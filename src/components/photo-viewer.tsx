import { useState } from 'react';
import { FlatList, Image, Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** One image fills each swipe page; contain preserves the original photo proportions. */
export function PhotoViewer({ photos, initialIndex = 0, onClose }: { photos: string[]; initialIndex?: number; onClose: () => void }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(initialIndex);
  const [pageHeight, setPageHeight] = useState(0);
  return <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
    <View style={[styles.screen, { paddingTop: insets.top, paddingBottom: insets.bottom }]}>
      <View style={styles.toolbar}><Pressable onPress={onClose} accessibilityLabel="Close photos" hitSlop={12} style={styles.close}><Ionicons name="close" color="#fff" size={28} /></Pressable></View>
      <View style={styles.viewport} onLayout={(event) => setPageHeight(event.nativeEvent.layout.height)}>
        {pageHeight > 0 && <FlatList key={width} horizontal pagingEnabled data={photos} initialScrollIndex={Math.min(initialIndex, photos.length - 1)} getItemLayout={(_data, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })} keyExtractor={(uri, itemIndex) => uri + itemIndex} showsHorizontalScrollIndicator={false} onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))} renderItem={({ item }) => <View style={{ width, height: pageHeight, justifyContent: 'center', alignItems: 'center' }}><Image source={{ uri: item }} style={{ width, height: pageHeight }} resizeMode="contain" /></View>} />}
      </View>
      <View style={styles.dots} accessibilityLabel={`Photo ${index + 1} of ${photos.length}`}>{photos.length > 1 && photos.map((_photo, itemIndex) => <View key={itemIndex} style={[styles.dot, index === itemIndex && styles.activeDot]} />)}</View>
    </View>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  toolbar: { height: 52, alignItems: 'flex-end', justifyContent: 'center' },
  close: { padding: 12, marginRight: 8 },
  viewport: { flex: 1 },
  dots: { height: 44, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#60646b' },
  activeDot: { backgroundColor: '#fff', width: 8, height: 8, borderRadius: 4 },
});
