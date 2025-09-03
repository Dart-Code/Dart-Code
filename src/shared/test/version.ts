import * as path from "path";
import * as semver from "semver";
import { DartTestCapabilities } from "../../shared/capabilities/dart_test";
import { dartVMPath } from "../../shared/constants";
import { DartSdks, Logger } from "../../shared/interfaces";
import { runProcess, safeSpawn } from "../processes";
import { WorkspaceContext } from "../workspace";

const cachedTestCapabilities: Record<string, DartTestCapabilities> = {};

export async function getPackageTestCapabilities(logger: Logger, workspaceContext: WorkspaceContext, folder: string): Promise<DartTestCapabilities> {
	// Don't ever run the command below in places like the SDK.
	if (workspaceContext.config.supportsDartRunTest === false)
		return DartTestCapabilities.empty;

	const sdks = workspaceContext.sdks as DartSdks;
	if (!cachedTestCapabilities[folder]) {
		const binPath = path.join(sdks.dart, dartVMPath);
		const proc = await runProcess(logger, binPath, ["run", "test:test", "--version"], folder, {}, safeSpawn);
		const capabilities = DartTestCapabilities.empty;
		if (proc.exitCode === 0) {
			const output = proc.stdout.trim();
			if (semver.valid(output))
				capabilities.version = output;
			else
				console.warn(`Failed to parse pkg:test version number: ${output}`);
		} else {
			const output = (proc.stdout.trim() + "\n" + proc.stderr.trim()).trim();
			console.warn(`Failed to get pkg:test version number: ${output}`);
		}

		cachedTestCapabilities[folder] = capabilities;
	}

	return cachedTestCapabilities[folder];

}
