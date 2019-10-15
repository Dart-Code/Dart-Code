console.log("Starting test runner...");

import * as fs from "fs";
import * as glob from "glob";
import * as Mocha from "mocha";
import * as path from "path";
import { MultiReporter } from "./mocha_multi_reporter";
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
			slow: 10000,       // increased threshold before marking a test as slow
			timeout: 180000,   // increased timeout because starting up Code, Analyzer, Pub, etc. is slooow
			ui: "bdd",        // the TDD UI is being used in extension.test.ts (suite, test, etc.)
			useColors: true,  // colored output from test results
		});
		// Use any mocha API
		mocha.useColors(true);

		// Set up source map support.
		require("source-map-support").install();

		const callbackAndQuit = (error: any, failures?: number) => {

			// Sometimes test runs hang because there are timers left around that
			// prevent Node from quitting. Mocha used to always call exit at the
			// end of a run, but that changed in v4. To avoid hanging CI builds,
			// write an error and then just quit if we're still around after 10 seconds.
			// unref() will prevent the timeout from keeping the process alive, so
			// if it quits normally the error will not be written.
			setTimeout(() => {
				console.error(`Test process did not quit within 10 seconds, calling exit!`);
				process.exit(1);
			}, 10000).unref();

			console.log(`Test run is complete! Will quit in 10 seconds if process is still alive...`);
			cb(error, failures);
		};

		glob("**/**.test.js", { cwd: testsRoot }, (err, files) => {
			if (err) {
				return callbackAndQuit(err);
			}

			// Add files to the test suite
			files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

			try {
				// Run the mocha test
				mocha.run((failures) => callbackAndQuit(null, failures));
			} catch (err) {
				callbackAndQuit(err);
			}
		});
	},
};
