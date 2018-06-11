import { TestRunner } from "./test_runner";

export class PubTest extends TestRunner {
	constructor(pubPath: string, projectFolder: string, args: string[], logFile: string, envOverrides?: any) {
		super(pubPath, projectFolder, ["run", "test", "-r", "json"].concat(args), logFile, envOverrides);
	}
}
