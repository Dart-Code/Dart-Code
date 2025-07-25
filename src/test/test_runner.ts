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
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		require("source-map-support").install();

		return new Promise(async (resolve, reject) => {
			try {
				let testPatterns = ["**/**.test.js"];

				// Apply test filters if provided
				const testFilter = process.env.DART_CODE_TEST_FILTER;
				if (testFilter) {
					try {
						const filters = JSON.parse(testFilter);
						if (Array.isArray(filters) && filters.length > 0) {
							// Create patterns for each filter, stripping .test.js suffix if present
							testPatterns = filters.map((filter) => {
								const cleanFilter = filter.replace(/\.test\.js$/, "");
								return `**/*${cleanFilter}*.test.js`;
							});
							console.log(`Filtering tests with patterns: ${testPatterns.join(", ")}`);
						}
					} catch (e) {
						// Fallback to single filter for backward compatibility
						const cleanFilter = testFilter.replace(/\.test\.js$/, "");
						testPatterns = [`**/*${cleanFilter}*.test.js`];
						console.log(`Filtering tests with pattern: ${testPatterns[0]}`);
					}
				}

				// Collect all matching files from all patterns
				const allFiles = new Set<string>();
				for (const pattern of testPatterns) {
					const files = await glob(pattern, { cwd: testsRoot });
					files.forEach((f) => allFiles.add(f));
				}

				const files = Array.from(allFiles).sort();

				// Add files to the test suite
				files.forEach((f) => mocha.addFile(path.resolve(testsRoot, f)));

				if (files.length === 0) {
					console.log(`No test files found matching patterns: ${testPatterns.join(", ")}`);
					resolve();
					return;
				}

				console.log(`Found ${files.length} test file(s):`, files);

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
