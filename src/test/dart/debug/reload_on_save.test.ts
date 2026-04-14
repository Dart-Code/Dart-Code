import { strict as assert } from "assert";
import { DebuggerType } from "../../../shared/enums";
import { startFakeDebugSession } from "../../debug_helpers";
import { activate, currentDoc, delay, setConfigForTest, setTestContent } from "../../helpers";

describe("hot reloads on save", () => {
	beforeEach("activate emptyFile", () => activate());

	function startSession(debuggerType: DebuggerType, hasStarted = true) {
		return startFakeDebugSession({
			debuggerType,
			hasStarted,
			id: "foo",
			name: "Fake Debug Session (hot reloads on save tests)",
		});
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

		const session = startSession(DebuggerType.Flutter, false);

		const doc = currentDoc();
		await setTestContent(doc.getText() + "// 1 ");

		assert.equal(session.hotReloadCount, 0);
		await doc.save();
		await delay(210); // Flutter has 10ms debounce
		assert.equal(session.hotReloadCount, 0); // No reload, we didn't set appStarted
	});
});
