import { ITest, reporters } from "mocha";
import { LogCategory, LogSeverity } from "../shared/enums";
import { InternalExtensionApi } from "../shared/vscode/interfaces";

export class LoggingReporter extends reporters.Base {
	constructor(runner: any, options: any) {
		super(runner);
		runner.on("start", () => {

			// TODO: Make this less hacky.

			runner.on("test", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi)
					extApi.log(`Starting test ${test.fullTitle()}...`, LogSeverity.Info, LogCategory.CI);
			});

			runner.on("pending", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi)
					extApi.log(`Test ${test.fullTitle()} pending/skipped`, LogSeverity.Info, LogCategory.CI);
			});

			runner.on("pass", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi)
					extApi.log(`Test ${test.fullTitle()} passed after ${test.duration}ms`, LogSeverity.Info, LogCategory.CI);
			});

			runner.on("fail", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi) {
					extApi.log(`Test ${test.fullTitle()} failed after ${test.duration}ms`, LogSeverity.Error, LogCategory.CI);
					const err = (test as any).err;
					if (err) {
						extApi.log(err.message, LogSeverity.Error, LogCategory.CI);
						extApi.log(err.stack, LogSeverity.Error, LogCategory.CI);
					}
				}
			});

			// runner.once("end", () => { });
		});
	}
}
