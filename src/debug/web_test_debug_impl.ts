import { DartLaunchRequestArguments } from "../shared/debug/interfaces";
import { SpawnedProcess } from "../shared/interfaces";
import { DartTestDebugSession } from "./dart_test_debug_impl";

export class WebTestDebugSession extends DartTestDebugSession {

	protected async spawnProcess(args: DartLaunchRequestArguments): Promise<SpawnedProcess> {
		// TODO: This!
		throw new Error("NYI");
	}
}
