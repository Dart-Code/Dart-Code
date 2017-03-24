import * as vs from "vscode";

export function upgradeProject() {
	remove_legacy_debug_settings();
}

function remove_legacy_debug_settings() {
	// Read launch.json config.
	let launchFile = vs.workspace.getConfiguration("launch");

	let configs = launchFile.get<any[]>("configurations");
	if (!configs)
		return;

	let hasChanged = false;

	// Find Dart CLI items that might need upgrading.
	configs.filter(c => c.type == "dart-cli").map(d => {
		// Remove the old sdkPath.
		if (d.sdkPath !== undefined) {
			console.log("Found old sdkPath, removing...");
			d.sdkPath = undefined;
			hasChanged = true;
		}

		// Remove the old debugSettings.
		if (d.debugSettings) {
			console.log("Found old debugSettings, removing...");
			d.debugSettings = undefined;
			hasChanged = true;
		}
	});

	if (hasChanged)
		launchFile.update("configurations", configs);
}
