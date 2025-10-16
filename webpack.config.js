const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const HtmlInlineScriptPlugin = require('html-inline-script-webpack-plugin');
const { LimitChunkCountPlugin } = require('webpack').optimize;

module.exports = {
    entry: './src/index.js',
    output: {
        filename: 'bundle.js',
        path: path.resolve(__dirname, 'dist'),
        publicPath: '',
        clean: true
    },
    mode: 'production',
    devtool: false,
    plugins: [
        new HtmlWebpackPlugin({
            template: './src/index.html',
            filename: 'index.html',
            inject: 'body',
            minify: {
                removeComments: true,
                collapseWhitespace: true,
                removeRedundantAttributes: true,
                useShortDoctype: true,
                removeEmptyAttributes: true,
                removeStyleLinkTypeAttributes: true,
                keepClosingSlash: true,
                minifyJS: true,
                minifyCSS: true,
                minifyURLs: true,
            },
        }),
        new LimitChunkCountPlugin({ maxChunks: 1 }),
        new HtmlInlineScriptPlugin(),
        // Copy PWA files
        {
            apply: (compiler) => {
                compiler.hooks.emit.tapAsync('CopyPWAFiles', (compilation, callback) => {
                    const fs = require('fs');
                    const path = require('path');

                    // Copy manifest.json
                    try {
                        const manifestContent = fs.readFileSync('./src/manifest.json', 'utf8');
                        compilation.assets['manifest.json'] = {
                            source: () => manifestContent,
                            size: () => manifestContent.length
                        };
                    } catch (error) {
                        console.warn('Could not copy manifest.json:', error.message);
                    }

                    // Copy service worker
                    try {
                        const swContent = fs.readFileSync('./src/sw.js', 'utf8');
                        compilation.assets['sw.js'] = {
                            source: () => swContent,
                            size: () => swContent.length
                        };
                    } catch (error) {
                        console.warn('Could not copy sw.js:', error.message);
                    }

                    // Create icons directory and copy PNG icons
                    try {
                        // Copy 192x192 icon
                        const icon192Buffer = fs.readFileSync('./src/images/PWA-192.png');
                        compilation.assets['icons/icon-192.png'] = {
                            source: () => icon192Buffer,
                            size: () => icon192Buffer.length
                        };

                        // Copy 512x512 icon
                        const icon512Buffer = fs.readFileSync('./src/images/PWA-512.png');
                        compilation.assets['icons/icon-512.png'] = {
                            source: () => icon512Buffer,
                            size: () => icon512Buffer.length
                        };

                        console.log('PWA icons copied successfully');
                    } catch (error) {
                        console.warn('Could not copy PWA icons:', error.message);
                    }

                    // Copy buildings.geojson
                    try {
                        const buildingsContent = fs.readFileSync('./src/buildings.geojson', 'utf8');
                        compilation.assets['buildings.geojson'] = {
                            source: () => buildingsContent,
                            size: () => buildingsContent.length
                        };
                        console.log('buildings.geojson copied successfully');
                    } catch (error) {
                        console.warn('Could not copy buildings.geojson:', error.message);
                    }

                    callback();
                });
            }
        }
    ],
    module: {
        rules: [
            {
                test: /\.css$/i,
                use: ['style-loader', 'css-loader']
            },
            {
                test: /\.geojson$/i,
                type: 'json'
            }
        ]
    },
    optimization: {
        splitChunks: false,
        runtimeChunk: false
    },
    target: ['web']
};
