import { DartLaunchRequestArguments } from "../shared/debug/interfaces";
import { DartTestDebugSession } from "./dart_test_debug_impl";

export class WebTestDebugSession extends DartTestDebugSession {

	protected spawnProcess(args: DartLaunchRequestArguments): any {
		// TODO: This!
	}
}
