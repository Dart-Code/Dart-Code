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
	forbidOnly: !!process.env.MOCHA_FORBID_ONLY,
	reporter: "mocha-multi-reporters",
	reporterOptions: {
		reporterEnabled: process.env.TEST_XML_OUTPUT ? "spec, xunit" : "spec",
		xunitReporterOptions: {
			output: process.env.TEST_XML_OUTPUT,
		},
	},
	slow: 1500,       // increased threshold before marking a test as slow
	timeout: 20000,   // increased timeout because starting up Code, Analyzer, etc. is slooow
	ui: "bdd",        // the TDD UI is being used in extension.test.ts (suite, test, etc.)
	useColors: true,  // colored output from test results
} as any); // TODO: Remove cast once vscode extension is updated.

module.exports = testRunner;
