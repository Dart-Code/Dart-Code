//@ts-check

"use strict";

// Webpack will output the following warnings when building:
//
// WARNING in ./node_modules/ws/lib/buffer-util.js
// Module not found: Error: Can't resolve 'bufferutil' in '/Users/dantup/Dev/Dart-Code/node_modules/ws/lib'
//
// WARNING in ./node_modules/ws/lib/validation.js
// Module not found: Error: Can't resolve 'utf-8-validate' in '/Users/dantup/Dev/Dart-Code/node_modules/ws/lib'
//
// These are caused by ws require()ing those two modules and they're not listed
// in our dependencies. Info on the reason for this is here:
// https://github.com/websockets/ws/blob/5d751fbd4c0ab3478a6de4194d4d06908bc8ac00/README.md#opt-in-for-performance-and-spec-compliance
//
// It appears to be safe to ignore these as they're being loaded in a try{} block
// and are optional.

const path = require("path");

module.exports = env => {
	/**
	 * @type {import("webpack").Configuration}
	 */
	const config = {
		devtool: "source-map",
		entry: "./src/extension/extension.ts",
		// https://webpack.js.org/configuration/externals/
		externals: {
			vscode: "commonjs vscode",
		},
		module: {
			rules: [{
				exclude: /node_modules/,
				test: /\.ts$/,
				loader: "ts-loader",
			}],
		},
		output: {
			devtoolModuleFilenameTemplate: "../../[resource-path]",
			filename: "extension.js",
			libraryTarget: "commonjs2",
			path: path.resolve(__dirname, "out/dist"),
		},
		resolve: {
			extensions: [".ts", ".js"],
		},
		target: "node",
	};

	if (env && env.instrumentation) {
		config.module.rules.push({
			enforce: "post",
			exclude: /node_modules/,
			test: /\.ts$/,
			loader: "istanbul-instrumenter-loader",
		});
	}

	return config;
};
