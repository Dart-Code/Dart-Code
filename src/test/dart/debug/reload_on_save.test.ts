import { strict as assert } from "assert";
import { DebugSession } from "vscode";
import { DebuggerType } from "../../../shared/enums";
import { DartDebugSessionInformation } from "../../../shared/vscode/interfaces";
import { activate, currentDoc, delay, extApi, setConfigForTest, setTestContent } from "../../helpers";

describe("hot reloads on save", () => {
	beforeEach("activate emptyFile", () => activate());

	function buildSession(debuggerType: DebuggerType): DebugSession & { hotReloadCount: number } {
		const configuration = {
			debuggerType,
			name: "Fake Debug Session",
			request: "launch",
			type: "dart",

		};

		const session = {
			configuration,
			hotReloadCount: 0,
			id: "foo",
			name: configuration.name,
			type: configuration.type,
			workspaceFolder: undefined,
			async getDebugProtocolBreakpoint() { return undefined; },
		};

		(session as unknown as DebugSession).customRequest = async (command) => {
			if (command === "hotReload")
				session.hotReloadCount++;
		};

		return session as any;
	}

	it("for Dart", async () => {
		await setConfigForTest("dart", "hotReloadOnSave", "manual");
		await setConfigForTest("dart", "flutterHotReloadOnSave", "never");

		const session = buildSession(DebuggerType.Dart);
		extApi.debugSessions.push(new DartDebugSessionInformation(session));

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

		const session = buildSession(DebuggerType.Flutter);
		const dartSession = new DartDebugSessionInformation(session);
		dartSession.hasStarted = true;
		extApi.debugSessions.push(dartSession);

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

		const session = buildSession(DebuggerType.Flutter);
		extApi.debugSessions.push(new DartDebugSessionInformation(session));

		const doc = currentDoc();
		await setTestContent(doc.getText() + "// 1 ");

		assert.equal(session.hotReloadCount, 0);
		await doc.save();
		assert.equal(session.hotReloadCount, 0); // No reload, we didn't set appStarted
	});
});
