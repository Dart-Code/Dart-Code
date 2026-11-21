import { strict as assert } from "assert";
import * as sinon from "sinon";
import * as vs from "vscode";
import { activateWithoutAnalysis, privateApi, sb, setConfigForTest, waitForResult } from "../helpers";

describe("HotReloadOnSaveHandler", () => {
	it("creates and disposes the **/*.dart watcher lazily based on dart.previewHotReloadOnSaveWatcher", async () => {
		await activateWithoutAnalysis();
		assert.ok(privateApi.hotReloadOnSaveHandler);
		assert.equal(privateApi.hotReloadOnSaveHandler.hasFileSystemWatcher, false);

		const disposeSpies: sinon.SinonSpy[] = [];
		const createWatcherStub = sb.stub(vs.workspace, "createFileSystemWatcher");
		createWatcherStub.callsFake((...args) => {
			const watcher = createWatcherStub.wrappedMethod.apply(vs.workspace, args);
			if (args[0] === "**/*.dart")
				disposeSpies.push(sb.spy(watcher, "dispose"));
			return watcher;
		});

		await setConfigForTest("dart", "previewHotReloadOnSaveWatcher", true);
		await waitForResult(() => createWatcherStub.withArgs("**/*.dart").calledOnce);
		assert.equal(privateApi.hotReloadOnSaveHandler.hasFileSystemWatcher, true);
		assert.equal(disposeSpies.length, 1);
		assert.equal(disposeSpies[0].called, false);

		await vs.workspace.getConfiguration("dart").update("previewHotReloadOnSaveWatcher", false, vs.ConfigurationTarget.Global);
		await waitForResult(() => disposeSpies[0].calledOnce);
		assert.equal(privateApi.hotReloadOnSaveHandler.hasFileSystemWatcher, false);
	});
});
