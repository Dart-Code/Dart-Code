import { strict as assert } from "assert";
import * as path from "path";
import * as sinon from "sinon";
import * as vs from "vscode";
import { DebugOption, DebuggerType } from "../../../shared/enums";
import { fsPath } from "../../../shared/utils/fs";
import { startFakeDebugSession } from "../../debug_helpers";
import { activate, currentDoc, getLaunchConfiguration, helloWorldExampleSubFolderMainFile, helloWorldFolder, helloWorldMainFile, helloWorldTestMainFile, myPackageThingFile, privateApi, sb, setTestContent } from "../../helpers";

describe("debug commands", () => {
	before("activate", () => activate());

	it("_dart.hotReload.withSave saves dirty files before reloading", async () => {
		const session = startFakeDebugSession({ debuggerType: DebuggerType.Dart, name: "Fake Debug Session (debug command tests)" });
		const saveAll = sb.stub(vs.workspace, "saveAll").resolves(true);

		const doc = currentDoc();
		await setTestContent(doc.getText() + "\n// dirty");

		await vs.commands.executeCommand("_dart.hotReload.withSave");

		assert.ok(saveAll.calledOnce);
		assert.equal(session.hotReloadCount, 1);
	});

	it("dart.rerunLastDebugSession reruns the most recently cached debug configuration", async () => {
		const firstDebugConfig = await getLaunchConfiguration(helloWorldMainFile);
		const lastDebugConfig = await getLaunchConfiguration(helloWorldTestMainFile);
		const startDebugging = sb.stub(vs.debug, "startDebugging").resolves(true);

		assert.ok(firstDebugConfig);
		assert.ok(lastDebugConfig);

		await vs.commands.executeCommand("dart.rerunLastDebugSession");

		assert.ok(startDebugging.calledOnce);
		assert.deepEqual(startDebugging.firstCall.args[0], vs.workspace.workspaceFolders?.[0]);
		assert.deepEqual(startDebugging.firstCall.args[1], lastDebugConfig);
	});

	it("dart.rerunLastTestDebugSession reruns the last cached test configuration", async () => {
		const testDebugConfig = await getLaunchConfiguration(helloWorldTestMainFile);
		const laterNonTestDebugConfig = await getLaunchConfiguration(helloWorldMainFile);
		const startDebugging = sb.stub(vs.debug, "startDebugging").resolves(true);

		assert.ok(testDebugConfig);
		assert.ok(laterNonTestDebugConfig);

		await vs.commands.executeCommand("dart.rerunLastTestDebugSession");

		assert.ok(startDebugging.calledOnce);
		assert.deepEqual(startDebugging.firstCall.args[0], vs.workspace.workspaceFolders?.[0]);
		assert.deepEqual(startDebugging.firstCall.args[1], testDebugConfig);
	});

	it("dart.promptForVmService prompts with the expected UI and normalizes ports", async () => {
		const showInputBox = sb.stub(vs.window, "showInputBox").callsFake(async (options) => {
			assert.equal(options?.ignoreFocusOut, true);
			assert.equal(options?.placeHolder, "Paste a VM Service URI or a port number");
			assert.equal(options?.prompt, "VM Service URI or port number");
			assert.equal(options?.value, "1234");
			assert.equal(options?.validateInput?.("8123"), undefined);
			assert.equal(options?.validateInput?.("ws://127.0.0.1:8123/ws"), undefined);
			assert.equal(options?.validateInput?.("ftp://127.0.0.1:8123"), "Please enter a valid VM Service URI or a port number");

			return "8123";
		});

		const result = await vs.commands.executeCommand<string | undefined>("dart.promptForVmService", "1234");

		assert.equal(result, "http://127.0.0.1:8123");
		assert.ok(showInputBox.calledOnceWithExactly(sinon.match.object));
	});

	it("createLaunchConfiguration adds a workspace-folder launch config for nested projects", async () => {
		const update = sb.stub().resolves();
		const inspect = sb.stub().returns({
			workspaceFolderValue: [{ name: "Existing", request: "launch", type: "dart" }],
			workspaceValue: undefined,
		});
		const openTextDocument = sb.stub(vs.workspace, "openTextDocument").resolves({} as vs.TextDocument);
		const showTextDocument = sb.stub(vs.window, "showTextDocument").resolves(undefined as any);
		sb.stub(vs.workspace, "getConfiguration").withArgs("launch", sinon.match.any).returns({
			inspect,
			update,
		} as any);

		await vs.commands.executeCommand("dart.createLaunchConfiguration", helloWorldExampleSubFolderMainFile);

		assert.ok(update.calledOnce);
		assert.equal(update.firstCall.args[0], "configurations");
		assert.deepEqual(update.firstCall.args[1], [
			{ name: "Existing", request: "launch", type: "dart" },
			{
				cwd: "example",
				name: `Dart (${path.join("bin", "main.dart")})`,
				program: path.join("bin", "main.dart"),
				request: "launch",
				type: "dart",
			},
		]);
		assert.equal(update.firstCall.args[2], vs.ConfigurationTarget.WorkspaceFolder);
		assert.ok(openTextDocument.calledOnceWithExactly(path.join(fsPath(helloWorldFolder), ".vscode", "launch.json")));
		assert.ok(showTextDocument.calledOnce);
	});

	it("getDebugSession returns undefined when there are no active sessions", async () => {
		const showQuickPick = sb.stub(vs.window, "showQuickPick");

		const session = await privateApi.debugCommands.getDebugSession();

		assert.equal(session, undefined);
		assert.equal(showQuickPick.called, false);
	});

	it("getDebugSession returns the only active session without prompting", async () => {
		const fakeSession = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "single-session", name: "Single Session" });
		const showQuickPick = sb.stub(vs.window, "showQuickPick");

		const session = await privateApi.debugCommands.getDebugSession();

		assert.equal(session?.session, fakeSession);
		assert.equal(showQuickPick.called, false);
	});

	it("getDebugSession prompts when multiple sessions are active", async () => {
		const firstSession = startFakeDebugSession({ debuggerType: DebuggerType.Dart, id: "session-1", name: "First Session" });
		const secondSession = startFakeDebugSession({ debuggerType: DebuggerType.Flutter, id: "session-2", name: "Second Session" });
		const showQuickPick = sb.stub(vs.window, "showQuickPick").callsFake(async (items, options) => {
			const sessionItems = items as Array<{ session: unknown }> | undefined;
			assert.equal(options?.placeHolder, "Which debug session?");
			assert.equal(sessionItems?.length, 2);
			return sessionItems?.[1];
		});

		const session = await privateApi.debugCommands.getDebugSession();

		assert.equal(session?.session, secondSession);
		assert.ok(showQuickPick.calledOnce);
		assert.notEqual(firstSession.id, secondSession.id);
	});

	it("_dart.toggleDebugOptions rotates through the debug options", async () => {
		const applyNewDebugOption = sb.stub(privateApi.debugCommands, "applyNewDebugOption");

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCode;

		await vs.commands.executeCommand("_dart.toggleDebugOptions");
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCodePackages);

		await vs.commands.executeCommand("_dart.toggleDebugOptions");
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCodePackagesSdk);

		await vs.commands.executeCommand("_dart.toggleDebugOptions");
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCode);

		assert.equal(applyNewDebugOption.callCount, 3);
	});

	it("handleBreakpointChange offers to debug all code for external Dart breakpoints", async () => {
		privateApi.debugCommands.hasPromptedAboutDebugSettings = false;

		const applyNewDebugOption = sb.stub(privateApi.debugCommands, "applyNewDebugOption");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves("Debug all code" as any);
		const breakpoint = new vs.SourceBreakpoint(new vs.Location(myPackageThingFile, new vs.Position(0, 0)), true);

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCode;
		privateApi.debugCommands.handleBreakpointChange({
			added: [breakpoint],
			changed: [],
			removed: [],
		});

		await Promise.resolve();

		assert.ok(showWarningMessage.calledOnce);
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCodePackagesSdk);
		assert.ok(applyNewDebugOption.calledOnce);
	});

	it("handleBreakpointChange does not prompt if already prompted", async () => {
		privateApi.debugCommands.hasPromptedAboutDebugSettings = true;

		const applyNewDebugOption = sb.stub(privateApi.debugCommands, "applyNewDebugOption");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves("Debug all code" as any);
		const breakpoint = new vs.SourceBreakpoint(new vs.Location(myPackageThingFile, new vs.Position(0, 0)), true);

		privateApi.debugCommands.currentDebugOption = DebugOption.MyCode;
		privateApi.debugCommands.handleBreakpointChange({
			added: [breakpoint],
			changed: [],
			removed: [],
		});

		await Promise.resolve();

		assert.ok(showWarningMessage.notCalled);
		assert.equal(privateApi.debugCommands.currentDebugOption, DebugOption.MyCode);
		assert.ok(applyNewDebugOption.notCalled);
	});
});
