const path = require('path');

module.exports = {
  entry: {
    content: './src/index.ts',
    background: './src/background.ts',
    interceptor: './src/interceptor.ts',
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
  devtool: 'source-map',
};