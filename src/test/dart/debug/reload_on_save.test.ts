import { strict as assert } from "assert";
import { DebugSession } from "vscode";
import { DebuggerType } from "../../../shared/enums";
import { activate, currentDoc, defer, delay, privateApi, setConfigForTest, setTestContent } from "../../helpers";

describe("hot reloads on save", () => {
	beforeEach("activate emptyFile", () => activate());

	function startSession(debuggerType: DebuggerType): DebugSession & { hotReloadCount: number } {
		const configuration = {
			debuggerType,
			name: "Fake Debug Session (hot reloads on save tests)",
			request: "launch",
			type: "dart",
		};

		let hotReloadCount = 0;
		const session = {
			configuration,
			id: "foo",
			name: configuration.name,
			type: configuration.type,
			workspaceFolder: undefined,
			async getDebugProtocolBreakpoint() { return undefined; },
			async customRequest(command: string) {
				if (command === "hotReload")
					hotReloadCount++;
			},
			get hotReloadCount() { return hotReloadCount; }
		} as DebugSession & { hotReloadCount: number };

		const dartSession = privateApi.debugCommands.handleDebugSessionStart(session)!;
		dartSession.hasStarted = true;
		defer("Remove fake debug session", () => privateApi.debugCommands.handleDebugSessionEnd(session));

		return session;
	}

	it("for Dart", async () => {
		await setConfigForTest("dart", "hotReloadOnSave", "manual");
		await setConfigForTest("dart", "flutterHotReloadOnSave", "never");

		const session = startSession(DebuggerType.Dart);

		const doc = currentDoc();
		await setTestContent(doc.getText() + "// 1 ");

		assert.equal(session.hotReloadCount, 0);
		await doc.save();
		await delay(400); // Dart has 200ms debounce
		assert.equal(session.hotReloadCount, 1);
	});

	it("for Flutter", async () => {
		await setConfigForTest("dart", "hotReloadOnSave", "never");
		await setConfigForTest("dart", "flutterHotReloadOnSave", "manual");

		const session = startSession(DebuggerType.Flutter);

		const doc = currentDoc();
		await setTestContent(doc.getText() + "// 1 ");

		assert.equal(session.hotReloadCount, 0);
		await doc.save();
		await delay(210); // Flutter has 10ms debounce
		assert.equal(session.hotReloadCount, 1);
	});

	it("for Flutter is skipped if app not started", async () => {
		await setConfigForTest("dart", "hotReloadOnSave", "never");
		await setConfigForTest("dart", "flutterHotReloadOnSave", "manual");

		const session = startSession(DebuggerType.Flutter);

		const doc = currentDoc();
		await setTestContent(doc.getText() + "// 1 ");

		assert.equal(session.hotReloadCount, 0);
		await doc.save();
		assert.equal(session.hotReloadCount, 0); // No reload, we didn't set appStarted
	});
});
