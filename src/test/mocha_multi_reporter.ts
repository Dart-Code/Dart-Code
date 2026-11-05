import { MochaOptions, ReporterConstructor, reporters, Runner } from "mocha";
import { CoverageReporter } from "./mocha_coverage_reporter";
import { LoggingReporter } from "./mocha_logging_reporter";

export class MultiReporter extends reporters.Base {
	constructor(runner: Runner, options: MochaOptions) {
		const reporterConstructors: ReporterConstructor[] = [
			reporters.Spec,
			LoggingReporter,
			CoverageReporter,
		];

		// Create all reporters; they'll subscribe to the events on runner.
		reporterConstructors.forEach((r) => new r(runner, options));
		super(runner);
	}
}
