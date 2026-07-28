module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [
      /**
       * Reanimated 4 moved its worklet transform into react-native-worklets.
       * expo-router's stack transitions depend on it, and it must be the last
       * plugin in the list.
       */
      'react-native-worklets/plugin',
    ],
  };
};
