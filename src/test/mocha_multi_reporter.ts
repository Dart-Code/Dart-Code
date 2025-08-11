import { reporters, Runner } from "mocha";
import { CoverageReporter } from "./mocha_coverage_reporter";
import { LoggingReporter } from "./mocha_logging_reporter";

export class MultiReporter extends reporters.Base {
	constructor(runner: Runner, options: any) {
		// These have to be any because the TS defs don't have the options argument.
		// TODO: Send a PR to fix?
		const reporterConstructors: any[] = [];
		reporterConstructors.push(reporters.Spec);
		reporterConstructors.push(LoggingReporter);
		reporterConstructors.push(CoverageReporter);

		// Create all reporters; they'll subscribe to the events on runner.
		reporterConstructors.forEach((r) => new r(runner, options));
		super(runner);
	}
}
