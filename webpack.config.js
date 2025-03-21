const path = require('path');

module.exports = {
    mode: 'production',
    entry: './public/sfu/MediasoupClientCompile.js',
    output: {
        path: require('path').resolve(__dirname, 'public/sfu'),
        filename: 'MediasoupClient.js',
    },
    module: {
        rules: [
            {
                test: /\.js$/,
                exclude: /node_modules/,
                use: {
                    loader: 'babel-loader',
                    options: {
                        presets: ['@babel/preset-env'],
                    },
                },
            },
        ],
    },
};
