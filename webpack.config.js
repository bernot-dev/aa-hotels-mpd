const path = require('path');
const webpack = require('webpack');

// Development builds (--mode development: npm run build:dev, npm run watch) include the debug
// tooling; production builds, which are what gets committed and released, leave it out entirely.
module.exports = (env, argv) => ({
  entry: {
    content: './src/index.ts',
    background: './src/background.ts',
    interceptor: './src/interceptor-main.ts',
    options: './src/options.ts',
  },
  mode: 'production',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  output: {
    filename: '[name].js',
    path: path.resolve(__dirname, 'dist'),
  },
  plugins: [
    new webpack.DefinePlugin({
      __AA_MPD_DEBUG__: JSON.stringify(argv.mode === 'development'),
    }),
  ],
  devtool: 'source-map',
});
