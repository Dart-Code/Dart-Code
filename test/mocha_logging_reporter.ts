import { ITest, reporters } from "mocha";
import { LogCategory, log } from "../src/utils/log";
import testRunner = require("vscode/lib/testrunner");

export class LoggingReporter extends reporters.Base {
	constructor(runner: any, options: any) {
		super(runner);

		// runner.on("start", () => { });

		runner.on("test", (test: ITest) => {
			log(`Starting test ${test.fullTitle()}...`, LogCategory.CI);
		});

		runner.on("pending", (test: ITest) => {
			log(`Test ${test.fullTitle()} pending/skipped`, LogCategory.CI);
		});

		runner.on("pass", (test: ITest) => {
			log(`Test ${test.fullTitle()} passed after ${test.duration}ms`, LogCategory.CI);
		});

		runner.on("fail", (test: ITest) => {
			log(`Test ${test.fullTitle()} failed after ${test.duration}ms`, LogCategory.CI);
			const err = (test as any).err;
			if (err) {
				log(err.message, LogCategory.CI);
				log(err.stack, LogCategory.CI);
			}
		});

		// runner.once("end", () => { });
	}
}
