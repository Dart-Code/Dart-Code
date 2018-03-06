import * as fs from "fs";
import testRunner = require("vscode/lib/testrunner");
const onExit = require("signal-exit"); // tslint:disable-line:no-var-requires

// Ensure we write coverage on exit.
declare const __coverage__: any;
onExit(() => {
	if (!fs.existsSync("./.nyc_output"))
		fs.mkdirSync("./.nyc_output");
	fs.writeFileSync("./.nyc_output/" + new Date().getTime() + ".json", JSON.stringify(__coverage__));
});

testRunner.configure({
	slow: 1500,       // increased threshold before marking a test as slow
	timeout: 30000,   // increased timeout because starting up Code, Analyzer, etc. is slooow
	ui: "bdd",        // the TDD UI is being used in extension.test.ts (suite, test, etc.)
	useColors: true,  // colored output from test results
});

module.exports = testRunner;
