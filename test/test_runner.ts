import * as fs from "fs";
import testRunner = require("vscode/lib/testrunner");
const onExit = require("signal-exit"); // tslint:disable-line:no-var-requires

// Ensure we write coverage on exit.
declare const __coverage__: any;
onExit(() => {
	// Unhandled exceptions here seem to hang, but console.error+process.exit do not! ¯\_(ツ)_/¯
	try {
		if (typeof __coverage__ !== "undefined" && typeof process.env.COVERAGE_OUTPUT !== "undefined" && process.env.COVERAGE_OUTPUT) {
			fs.writeFileSync(process.env.COVERAGE_OUTPUT, JSON.stringify(__coverage__));
		}
	} catch (e) {
		console.error(e);
		process.exit(1);
	}
});

testRunner.configure({
	reporter: "list",
	slow: 1500,       // increased threshold before marking a test as slow
	timeout: 10000,   // increased timeout because starting up Code, Analyzer, etc. is slooow
	ui: "bdd",        // the TDD UI is being used in extension.test.ts (suite, test, etc.)
	useColors: true,  // colored output from test results
});

module.exports = testRunner;
