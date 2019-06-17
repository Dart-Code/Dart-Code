import { ITest, reporters } from "mocha";
import { LogCategory } from "../shared/enums";
import { InternalExtensionApi } from "../shared/vscode/interfaces";

export class LoggingReporter extends reporters.Base {
	constructor(runner: any, options: any) {
		super(runner);
		runner.on("start", () => {

			// TODO: Make this less hacky.

			runner.on("test", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi)
					extApi.logger.info(`Starting test ${test.fullTitle()}...`, LogCategory.CI);
			});

			runner.on("pending", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi)
					extApi.logger.info(`Test ${test.fullTitle()} pending/skipped`, LogCategory.CI);
			});

			runner.on("pass", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi)
					extApi.logger.info(`Test ${test.fullTitle()} passed after ${test.duration}ms`, LogCategory.CI);
			});

			runner.on("fail", (test: ITest) => {
				const extApi: InternalExtensionApi = require("./helpers").extApi;
				if (extApi) {
					extApi.logger.error(`Test ${test.fullTitle()} failed after ${test.duration}ms`, LogCategory.CI);
					const err = (test as any).err;
					if (err) {
						extApi.logger.error(err.message, LogCategory.CI);
						extApi.logger.error(err.stack, LogCategory.CI);
					}
				}
			});

			// runner.once("end", () => { });
		});
	}
}
