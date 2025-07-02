import { reporters, Runner, Test } from "mocha";
import { LogCategory } from "../shared/enums";
import { InternalExtensionApi } from "../shared/vscode/interfaces";

function getLogger() {
	// TODO: Make a logger that buffers then flushes when it gets the real one.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const extApi: InternalExtensionApi = require("./helpers").extApi;
	return extApi && extApi.logger;
}

export class LoggingReporter extends reporters.Base {
	constructor(runner: Runner, options: any) {
		super(runner);
		runner.on("start", () => {

			runner.on("test", (test: Test) => {
				const logger = getLogger();
				if (logger)
					logger.info(`Starting test ${test.fullTitle()}...`, LogCategory.CI);
			});

			runner.on("pending", (test: Test) => {
				const logger = getLogger();
				if (logger)
					logger.info(`Test ${test.fullTitle()} pending/skipped (${test.state})`, LogCategory.CI);
			});

			runner.on("pass", (test: Test) => {
				const logger = getLogger();
				if (logger)
					logger.info(`Test ${test.fullTitle()} passed after ${test.duration}ms`, LogCategory.CI);
			});

			runner.on("fail", (test: Test) => {
				const logger = getLogger();
				if (logger) {
					logger.error(`Test ${test.fullTitle()} failed after ${test.duration}ms`, LogCategory.CI);
					// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
					const err = (test as any).err;
					if (err) {
						logger.error(err.message, LogCategory.CI);
						logger.error(err.stack, LogCategory.CI);
					}
				}
			});

			// runner.once("end", () => { });
		});
	}
}
