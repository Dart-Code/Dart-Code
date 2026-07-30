import { strict as assert } from "assert";
import * as vs from "vscode";
import { activate, helloWorldMainFile } from "../../helpers";

describe("toggle show TODOs", () => {
	const settingName = "showTodos";
	let config: vs.WorkspaceConfiguration;

	function refresh(): void {
		config = vs.workspace.getConfiguration("dart");
	}

	beforeEach(async () => {
		await activate(helloWorldMainFile);
		refresh();
		// Clear overrides to start from a clean state.
		await config.update(settingName, undefined, vs.ConfigurationTarget.Global);
		await config.update(settingName, undefined, vs.ConfigurationTarget.Workspace);
		refresh();
	});

	it("toggles in Workspace settings when defined in Folder settings (multi-root workspace)", async () => {
		await config.update(settingName, false, vs.ConfigurationTarget.Workspace);
		refresh();
		assert.strictEqual(config.get(settingName), false);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, true);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, false);
	});
});
