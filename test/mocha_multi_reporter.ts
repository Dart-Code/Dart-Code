import { IRunner, reporters } from "mocha";
import { LoggingReporter } from "./mocha_logging_reporter";

class MultiReporter extends reporters.Base {
	constructor(runner: IRunner, options: any) {
		// These have to be any because the TS defs don't have the options argument.
		// TODO: Send a PR to fix?
		const reporterConstructors: any[] = [];
		reporterConstructors.push(reporters.Spec);
		reporterConstructors.push(LoggingReporter);
		if (process.env.TEST_XML_OUTPUT)
			reporterConstructors.push(reporters.XUnit);

		// Create all reporters; they'll subscribe to the events on runner.
		const rs = reporterConstructors.map((r) => new r(runner, options));
		super(runner);
	}
}
