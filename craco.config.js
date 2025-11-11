module.exports = {
  webpack: {
    configure: (webpackConfig, { env, paths }) => {
      webpackConfig.resolve.fallback = {
        ...webpackConfig.resolve.fallback,
        module: false,
        fs: false,
        path: require.resolve("path-browserify"),
      };
      return webpackConfig;
    },
  },
};