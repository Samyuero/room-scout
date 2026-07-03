const appConfig = require('./app.json');

const mapsApiKey =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const expo = {
  ...appConfig.expo,
  extra: {
    ...appConfig.expo.extra,
    hasGoogleMapsApiKey: Boolean(mapsApiKey),
  },
  android: {
    ...appConfig.expo.android,
    config: {
      ...appConfig.expo.android?.config,
      googleMaps: {
        ...appConfig.expo.android?.config?.googleMaps,
        apiKey: mapsApiKey,
      },
    },
  },
  plugins: appConfig.expo.plugins.map((plugin) => {
    const name = Array.isArray(plugin) ? plugin[0] : plugin;

    if (name !== 'react-native-maps') {
      return plugin;
    }

    return [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: mapsApiKey,
      },
    ];
  }),
};

if (!mapsApiKey) {
  console.warn(
    'GOOGLE_MAPS_API_KEY is not set. Android APK map screens can crash or show a blank map until you set it and rebuild.'
  );
}

module.exports = { expo };
