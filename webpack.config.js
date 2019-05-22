// Current status: Broken.
// Running unpacked tests with the packed extension doesn't work for two main reasons:
//
// 1. State is duplicated - referenced in the packed extension code, and the unpacked tests.
//    This means if we run some extension code then try to read the state in a test to verify
//    it, it's not there.
// 2. Class definitions are also duplicated. If a test gets a class from the extension and then
//    does `item instanceof SomeClass` it will fail because the `SomeClass` the test references
//    is not the same one that the extension used to create the instance.

"use strict";

const path = require("path");

/**
 * @type {import('webpack').Configuration}
 */
const config = {
	devtool: "source-map",
	entry: "./src/extension.ts",
	externals: {
		vscode: "commonjs vscode",
		ws: "ws",
	},
	module: {
		rules: [{
			exclude: /node_modules/,
			test: /\.ts$/,
			use: [{
				loader: "ts-loader",
			}],
		}],
	},
	output: {
		devtoolModuleFilenameTemplate: "../[resource-path]",
		filename: "extension.js",
		libraryTarget: "commonjs2",
		path: path.resolve(__dirname, "out/dist"),
	},
	resolve: {
		extensions: [".ts", ".js"],
	},
	target: "node",
};

module.exports = config;
