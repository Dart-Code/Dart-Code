import { ITest, reporters } from "mocha";
import { log } from "../extension/utils/log";
import { LogCategory, LogSeverity } from "../shared/enums";
import testRunner = require("vscode/lib/testrunner");

export class LoggingReporter extends reporters.Base {
	constructor(runner: any, options: any) {
		super(runner);

		// runner.on("start", () => { });

		runner.on("test", (test: ITest) => {
			log(`Starting test ${test.fullTitle()}...`, LogSeverity.Info, LogCategory.CI);
		});

		runner.on("pending", (test: ITest) => {
			log(`Test ${test.fullTitle()} pending/skipped`, LogSeverity.Info, LogCategory.CI);
		});

		runner.on("pass", (test: ITest) => {
			log(`Test ${test.fullTitle()} passed after ${test.duration}ms`, LogSeverity.Info, LogCategory.CI);
		});

		runner.on("fail", (test: ITest) => {
			log(`Test ${test.fullTitle()} failed after ${test.duration}ms`, LogSeverity.Error, LogCategory.CI);
			const err = (test as any).err;
			if (err) {
				log(err.message, LogSeverity.Error, LogCategory.CI);
				log(err.stack, LogSeverity.Error, LogCategory.CI);
			}
		});

		// runner.once("end", () => { });
	}
}
