import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { modifyingFilesOutsideWorkspaceInfoUrl, moreInfoAction } from "../../shared/constants";
import { activate, createTempTestFile, delay, getRandomTempFolder, saveTrivialChangeToFile, sb, setConfigForTest, waitForResult } from "../helpers";

describe("file change warnings", () => {
	before("activate", () => activate());

	it("warns only once when editing a Dart file outside the workspace", async () => {
		await setConfigForTest("dart", "warnWhenEditingFilesOutsideWorkspace", true);
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(undefined);
		const file = createExternalTestFile(path.join("outside_workspace", "lib", "warn_once.dart"), "void main() {}\n");

		await saveTrivialChangeToFile(file);

		await waitForResult(() => showWarningMessage.calledOnce);
		assert.equal(showWarningMessage.firstCall.args[0], "You are modifying a file outside of your open folders");
		assert.deepEqual(showWarningMessage.firstCall.args.slice(1), [moreInfoAction, "Don't Warn Me"]);

		await saveTrivialChangeToFile(file);
		await delay(100);
		assert.equal(showWarningMessage.callCount, 1);
	});

	it("opens more info when requested for outside-workspace edits", async () => {
		await setConfigForTest("dart", "warnWhenEditingFilesOutsideWorkspace", true);
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(moreInfoAction as any);
		const openExternal = sb.stub(vs.env, "openExternal").resolves(true);
		const file = createExternalTestFile(path.join("outside_workspace", "lib", "more_info.dart"), "void main() {}\n");

		await saveTrivialChangeToFile(file);

		await waitForResult(() => openExternal.calledOnce);
		assert.equal(showWarningMessage.firstCall.args[0], "You are modifying a file outside of your open folders");
		assert.ok(openExternal.calledOnceWithExactly(vs.Uri.parse(modifyingFilesOutsideWorkspaceInfoUrl)));
	});

	it("uses the pub cache warning and can disable future prompts", async () => {
		await setConfigForTest("dart", "warnWhenEditingFilesInPubCache", true);
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves("Don't Warn Me" as any);
		const file = createExternalTestFile(path.join("cache_root", "hosted", "pub.dev", "example_pkg", "lib", "cached.dart"), "void main() {}\n");

		await saveTrivialChangeToFile(file);

		await waitForResult(() => vs.workspace.getConfiguration("dart").get("warnWhenEditingFilesInPubCache") === false);
		assert.equal(showWarningMessage.firstCall.args[0], "You are modifying a file in the Pub cache!");
	});
});

function createExternalTestFile(relativePath: string, content: string): vs.Uri {
	const tempFolder = getRandomTempFolder();
	const absolutePath = path.join(tempFolder, relativePath);
	createTempTestFile(absolutePath, content);
	return vs.Uri.file(absolutePath);
}
