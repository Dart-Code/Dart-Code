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

	// (multi-root) Workspaces are tested in the 'multi_root' tests. This test project is a single folder.

	it("toggles in User settings when not defined anywhere", async () => {
		// Default is true.
		refresh();
		assert.strictEqual(config.get(settingName), true);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, false);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, true);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
	});

	it("toggles in User settings when defined in User settings", async () => {
		await config.update(settingName, false, vs.ConfigurationTarget.Global);
		refresh();
		assert.strictEqual(config.get(settingName), false);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, true);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, false);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);
	});

	it("toggles in User settings when defined in User settings as an array", async () => {
		await config.update(settingName, ["TODO", "HACK"], vs.ConfigurationTarget.Global);
		refresh();
		assert.deepStrictEqual(config.get(settingName), ["TODO", "HACK"]);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), false);
		assert.strictEqual(config.inspect(settingName)?.globalValue, false);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);

		await vs.commands.executeCommand("dart.toggleShowTodos");
		refresh();
		assert.strictEqual(config.get(settingName), true);
		assert.strictEqual(config.inspect(settingName)?.globalValue, true);
		assert.strictEqual(config.inspect(settingName)?.workspaceValue, undefined);
		assert.strictEqual(config.inspect(settingName)?.workspaceFolderValue, undefined);
	});

	it("toggles in Workspace (Folder) settings when defined in Workspace (Folder) settings (single-root workspace)", async () => {
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
