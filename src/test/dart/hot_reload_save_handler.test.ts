import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activateWithoutAnalysis, ext, sb, setConfigForTest, waitForResult } from "../helpers";

describe("HotReloadOnSaveHandler", () => {
	it("creates and disposes the **/*.dart watcher lazily based on dart.previewHotReloadOnSaveWatcher", async () => {
		const wasAlreadyActive = ext.isActive;
		const disposeSpies: sinon.SinonSpy[] = [];
		const createWatcherStub = sb.stub(vs.workspace, "createFileSystemWatcher");
		createWatcherStub.callsFake((...args) => {
			const watcher = createWatcherStub.wrappedMethod.apply(vs.workspace, args);
			if (args[0] === "**/*.dart")
				disposeSpies.push(sb.spy(watcher, "dispose"));
			return watcher;
		});

		await activateWithoutAnalysis();
		if (!wasAlreadyActive)
			assert.equal(createWatcherStub.withArgs("**/*.dart").callCount, 0);

		await setConfigForTest("dart", "previewHotReloadOnSaveWatcher", true);
		await waitForResult(() => createWatcherStub.withArgs("**/*.dart").calledOnce);
		assert.equal(disposeSpies.length, 1);
		assert.equal(disposeSpies[0].called, false);

		await vs.workspace.getConfiguration("dart").update("previewHotReloadOnSaveWatcher", false, vs.ConfigurationTarget.Global);
		await waitForResult(() => disposeSpies[0].calledOnce);
	});
});
