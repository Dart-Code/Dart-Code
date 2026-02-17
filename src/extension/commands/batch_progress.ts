import * as path from "path";
import * as vs from "vscode";
import { maxConcurrentProcesses, runWithConcurrencyLimit } from "../../shared/pub/utils";
import { fsPath, tryGetPackageName } from "../../shared/utils/fs";
import { config } from "../config";
import { OperationProgress } from "./sdk";

export async function runBatchFolderOperation(
	uris: vs.Uri[],
	operationProgress: OperationProgress,
	runSingleOperation: (uri: vs.Uri, operationProgress: OperationProgress) => Promise<unknown>,
): Promise<void> {
	const hiddenProgress: vs.Progress<{ message?: string; increment?: number }> = { report: (_) => undefined };
	const childOperationProgress: OperationProgress = {
		cancellationToken: operationProgress.cancellationToken,
		progressReporter: hiddenProgress,
	};

	const maxConcurrent = config.runPubConcurrently
		? Math.min(uris.length, maxConcurrentProcesses)
		: 1;
	const activePackages = new Map<string, string>();
	let numCompleted = 0;

	function updateProgress(increment?: boolean) {
		const activePackageNames = [...activePackages.values()];
		const firstPackageName = activePackageNames[0];
		const numTotal = uris.length;
		const numRemaining = numTotal - numCompleted;

		// Instead of using the actual count here (activePackageNames.length - 1), which causes
		// flickering as one completes and reduces the count before the next starts, just give
		// an approximate value of the cap of Min(maxConcurrent, remaining) - 1 instead.
		const otherActiveCount = Math.min(maxConcurrent, numRemaining) - 1;
		if (firstPackageName) {
			const statusMessage = otherActiveCount > 0
				? `${firstPackageName} (+ ${otherActiveCount} others)...`
				: firstPackageName;
			operationProgress.progressReporter.report({
				message: `${statusMessage} (${numCompleted}/${numTotal} total)`,
				increment: increment ? 100 / numTotal : undefined,
			});
		}
	}

	updateProgress();
	await runWithConcurrencyLimit(
		uris,
		maxConcurrent,
		operationProgress.cancellationToken,
		async (item: vs.Uri) => runSingleOperation(item, childOperationProgress).then(() => undefined),
		(newCompleted: number, _total: number, item: vs.Uri) => {
			numCompleted = newCompleted;
			activePackages.delete(fsPath(item));
			updateProgress(true);
		},
		(item: vs.Uri) => {
			const itemPath = fsPath(item);
			// Before choosing to use the folder name, try to use `package:foo`.
			let packageOrFolderDisplayName: string;
			const packageName = tryGetPackageName(itemPath);
			if (packageName) {
				packageOrFolderDisplayName = `package:${packageName}`;
			} else {
				// Display the relative path from the workspace root to the folder we're running up to two segments.
				packageOrFolderDisplayName = path.basename(itemPath);
			}
			activePackages.set(itemPath, packageOrFolderDisplayName);
			updateProgress();
		},
	);
}
