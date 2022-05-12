import * as path from "path";
import * as semver from "semver";
import { DartTestCapabilities } from "../../shared/capabilities/dart_test";
import { dartVMPath } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { runProcess, safeSpawn } from "../processes";

export async function getPackageTestCapabilities(logger: Logger, sdks: DartSdks, folder: string): Promise<DartTestCapabilities> {
	const binPath = path.join(sdks.dart, dartVMPath);
	const proc = await runProcess(logger, binPath, ["run", "test:test", "--version"], folder, {}, safeSpawn);
	const capabilities = DartTestCapabilities.empty;
	if (proc.exitCode === 0) {
		if (semver.valid(proc.stdout.trim()))
			capabilities.version = proc.stdout.trim();
	}
	return capabilities;

}
