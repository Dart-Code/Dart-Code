import { TestRunner } from "./test_runner";
import { globalFlutterArgs } from "./utils";

export class FlutterTest extends TestRunner {
	constructor(flutterBinPath: string, projectFolder: string, args: string[], logFile: string, logger: (message: string) => void) {
		super(flutterBinPath, projectFolder, globalFlutterArgs.concat(["test", "--machine"]).concat(args), logFile, logger);
	}
}
