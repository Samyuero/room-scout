import { Image } from 'expo-image';
import { useWindowDimensions, View } from 'react-native';

export function AuthBrand() {
  const { width, height } = useWindowDimensions();
  const size = Math.min(144, width * 0.4, height * 0.17);
  // The source artwork has wide transparent margins. Clip only those margins,
  // keeping the original logo unchanged and visibly large on small screens.
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={{ width: size, height: size, overflow: 'hidden' }}>
        <Image
          accessibilityLabel="RoomScout logo"
          source={require('../../assets/logo.png')}
          contentFit="contain"
          style={{ position: 'absolute', width: size * 2, height: size * 2, left: -size / 2, top: -size / 2 }}
        />
      </View>
    </View>
  );
}

export function GoogleMark() {
  return <Image source={require('../../assets/google-g.svg')} contentFit="contain" style={{ width: 21, height: 21 }} />;
}
