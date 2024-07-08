console.log("Starting test runner...");

import { glob } from "glob";
import { default as Mocha } from "mocha";
import * as path from "path";
import { isCI } from "../shared/constants";
import { MultiReporter } from "./mocha_multi_reporter";

module.exports = {
	async run(testsRoot: string): Promise<void> {
		// Create the mocha test
		const mocha = new Mocha({
			color: true,
			forbidOnly: !!process.env.MOCHA_FORBID_ONLY,
			reporter: MultiReporter,
			reporterOptions: {
				output: process.env.TEST_XML_OUTPUT,
				testRunName: process.env.TEST_RUN_NAME,
			},
			retries: isCI ? 2 : 0,        // Retry failing tests to reduce flakes
			slow: 20000,       // increased threshold before marking a test as slow
			timeout: 360000,   // increased timeout because starting up Code, Analyzer, Pub, etc. is slooow
			ui: "bdd",         // the TDD UI is being used in extension.test.ts (suite, test, etc.)
		});

		// Set up source map support.
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		require("source-map-support").install();

		return new Promise(async (resolve, reject) => {
			try {
				const files = await glob("**/**.test.js", { cwd: testsRoot });

				// Add files to the test suite
				files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

				// Run the mocha test
				mocha.run((failures) => {
					if (failures > 0) {
						reject(new Error(`${failures} tests failed.`));
					} else {
						resolve();
					}
				});
			} catch (err) {
				return reject(err);
			}
		});
	},
};
