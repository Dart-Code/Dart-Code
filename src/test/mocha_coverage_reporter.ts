/* eslint-disable no-underscore-dangle */
import * as fs from "fs";
import { reporters, Runner } from "mocha";

declare const __coverage__: any;

export class CoverageReporter extends reporters.Base {
	constructor(runner: Runner, _options: any) {
		super(runner);

		runner.once("end", () => {
			try {
				if (typeof __coverage__ !== "undefined" && typeof process.env.COVERAGE_OUTPUT !== "undefined" && process.env.COVERAGE_OUTPUT) {
					fs.writeFileSync(process.env.COVERAGE_OUTPUT, JSON.stringify(__coverage__));
				}
			} catch (e) {
				console.error("Failed to write coverage!");
				console.error(e);
			}
		});
	}
}
