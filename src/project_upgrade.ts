import * as vs from "vscode";

export function upgradeProject() {
	update_launch_json_change_sdk_to_settings();
	update_launch_json_change_command_to_colon();
}

function update_launch_json_change_sdk_to_settings() {
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

		// Add the new debugSettings.
		if (!d.debugSettings) {
			console.log("Didn't find debugSettings, adding...");
			d.debugSettings = "${command:debugSettings}";
			hasChanged = true;
		}
	});

	if (hasChanged)
		launchFile.update("configurations", configs);
}

function update_launch_json_change_command_to_colon() {
	// Read launch.json config.
	let launchFile = vs.workspace.getConfiguration("launch");

	let configs = launchFile.get<any[]>("configurations");
	if (!configs)
		return;

	let hasChanged = false;

	// Find Dart CLI items that might need upgrading.
	configs.filter(c => c.type == "dart-cli").map(d => {
		// Add the new debugSettings.
		if (d.debugSettings == "${command.debugSettings}") {
			console.log("Found old debugSettings, updating...");
			d.debugSettings = "${command:debugSettings}";
			hasChanged = true;
		}
	});

	if (hasChanged)
		launchFile.update("configurations", configs);
}
