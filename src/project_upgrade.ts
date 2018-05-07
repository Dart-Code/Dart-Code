import * as vs from "vscode";

export function upgradeProject(workspaces: vs.WorkspaceFolder[]) {
	for (const workspace of workspaces) {
		remove_legacy_debug_settings(workspace);
		convert_legacy_debug_types(workspace);
	}
}

function remove_legacy_debug_settings(workspace: vs.WorkspaceFolder) {
	// Read launch.json config.
	const launchFile = vs.workspace.getConfiguration("launch", workspace.uri);

	const configs = launchFile.get<any[]>("configurations");
	if (!configs)
		return;

	let hasChanged = false;

	// Find Dart CLI items that might need upgrading.
	configs.filter((c) => c.type === "dart-cli").map((d) => {
		// Remove the old sdkPath.
		if (d.sdkPath !== undefined) {
			console.log("Found old sdkPath, removing…");
			d.sdkPath = undefined;
			hasChanged = true;
		}

		// Remove cwd if it's default.
		if (d.cwd === "${workspaceRoot}") {
			console.log("Found default workspaceRoot, removing…");
			d.cwd = undefined;
			hasChanged = true;
		}

		// Remove args if they're default.
		if (d.args && d.args.length === 0) {
			console.log("Found default args, removing…");
			d.args = undefined;
			hasChanged = true;
		}
	});

	if (hasChanged)
		launchFile.update("configurations", configs, vs.ConfigurationTarget.WorkspaceFolder);
}

function convert_legacy_debug_types(workspace: vs.WorkspaceFolder) {
	// Read launch.json config.
	const launchFile = vs.workspace.getConfiguration("launch", workspace.uri);

	const configs = launchFile.get<any[]>("configurations");
	if (!configs)
		return;

	let hasChanged = false;

	// Find Dart CLI items that might need upgrading.
	configs.filter((c) => c.type === "dart-cli" || c.type === "flutter").map((d) => {
		console.log("Found old dart-cli/flutter debug type, setting to dart…");
		d.type = "dart";
		hasChanged = true;
	});

	if (hasChanged)
		launchFile.update("configurations", configs, vs.ConfigurationTarget.WorkspaceFolder);
}
