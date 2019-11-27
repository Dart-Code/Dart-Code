console.log("Starting test runner...");

import * as glob from "glob";
import * as Mocha from "mocha";
import * as path from "path";
import { MultiReporter } from "./mocha_multi_reporter";

module.exports = {
	run(testsRoot: string, cb: (error: any, failures?: number) => void): void {
		// Create the mocha test
		const mocha = new Mocha({
			forbidOnly: !!process.env.MOCHA_FORBID_ONLY,
			reporter: MultiReporter,
			reporterOptions: {
				output: process.env.TEST_XML_OUTPUT,
				summaryFile: process.env.TEST_CSV_SUMMARY,
				testRunName: process.env.TEST_RUN_NAME,
			},
			slow: 30000,       // increased threshold before marking a test as slow
			timeout: 360000,   // increased timeout because starting up Code, Analyzer, Pub, etc. is slooow
			ui: "bdd",        // the TDD UI is being used in extension.test.ts (suite, test, etc.)
			useColors: true,  // colored output from test results
		});
		// Use any mocha API
		mocha.useColors(true);

		// Set up source map support.
		require("source-map-support").install();

		const callCallback = (error: any, failures?: number) => {
			setTimeout(() => {
				console.error(`Test process did not quit within 10 seconds!`);
			}, 10000).unref();

			console.log(`Test run is complete! Calling VS Code callback with (${error}, ${failures})`);
			cb(error, failures);
		};

		glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
			if (err) {
				return callCallback(err);
			}

			// Add files to the test suite
			files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run((failures) => callCallback(null, failures));
			} catch (err) {
				callCallback(err);
			}
		});
	},
};
