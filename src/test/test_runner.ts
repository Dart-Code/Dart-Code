import { glob } from "glob";
import { minimatch } from "minimatch";
import { default as Mocha } from "mocha";
import * as path from "path";
import { isCI } from "../shared/constants";
import { MultiReporter } from "./mocha_multi_reporter";

function normalizeTestFilter(filter: string): string {
	return filter
		// Convert backslashes to forward slashes for glob.
		.replace(/\\/g, "/")
		// Remove leading "./" if present.
		.replace(/^\.\//, "")
		// Replace any .ts with .js.
		.replace(/\.ts$/, ".js");
}

export async function getTestSuites(testsRoot: string, filters: string[] | undefined): Promise<string[]> {
	let allFiles = await glob("**/**.test.js", { cwd: testsRoot });
	allFiles = allFiles.map((f) => path.resolve(testsRoot, f));
	allFiles.sort();

	if (!filters?.length)
		return allFiles;

	// If there are filters, return those that match any of them. Filters match
	// absolute paths so that repository-relative filters like
	// "src/test/dart/utils/fs.test.ts" keep working; dot: true ensures hidden
	// folders in ancestors of testsRoot do not prevent "**" from matching
	// (files inside hidden folders below testsRoot are already excluded by the
	// glob call above).
	const files = new Set<string>();
	for (let filter of filters.map(normalizeTestFilter)) {
		filter = `**/*${filter}*`;
		allFiles.filter((file) => minimatch(file, filter, { dot: true })).forEach((f) => files.add(f));
	}
	return [...files].sort();
}

module.exports = {
	getTestSuites,

	async run(testsRoot: string): Promise<void> {
		console.log("\nStarting test runner...\n");

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

		const testFilter = process.env.DART_CODE_TEST_FILTER;
		const filters: string[] | undefined = testFilter ? JSON.parse(testFilter) : undefined;
		const files = await getTestSuites(testsRoot, filters);

		// Add files to the test suite
		files.forEach((f) => mocha.addFile(f));

		if (files.length === 0) {
			console.log(`No test files found.`);
			return;
		}

		// Run the mocha test
		return new Promise((resolve, reject) => {
			mocha.run((failures) => {
				if (failures > 0)
					reject(new Error(`${failures} tests failed.`));
				else
					resolve();
			});
		});
	},
};
