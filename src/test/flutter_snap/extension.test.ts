import * as assert from "assert";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { initializeSnapPrompt, isLinux, yesAction } from "../../shared/constants";
import { fsPath } from "../../shared/utils/fs";
import { activate, extApi, logger, sb } from "../helpers";
import sinon = require("sinon");

describe("test environment", () => {
	it("has opened the correct folder", () => {
		const wfs = vs.workspace.workspaceFolders || [];
		assert.equal(wfs.length, 1);
		assert.ok(
			fsPath(wfs[0].uri).endsWith(path.sep + "empty"),
			`${fsPath(wfs[0].uri)} doesn't end with ${path.sep}empty`,
		);
	});
});

describe("extension", () => {
	beforeEach(function () {
		if (!isLinux)
			this.skip();
	});

	it("initializes the snap and locates the SDK", async () => {
		// Automatically approve the initialization.
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
		const initializeSnapMessagePrompt = showInformationMessage.withArgs(initializeSnapPrompt, sinon.match.any).resolves(yesAction);

		await activate();

		assert.ok(initializeSnapMessagePrompt.calledOnce);

		const workspaceContext = extApi.workspaceContext;

		assert.ok(workspaceContext.sdks);
		assert.ok(workspaceContext.sdks.dart);
		assert.equal(workspaceContext.sdks.flutter, `${path.join(os.homedir(), "/snap/flutter/common/flutter")}`);
		assert.ok(workspaceContext.config);
		assert.equal(workspaceContext.config?.dartSdkHomeLinux, undefined);
		assert.equal(workspaceContext.config?.dartSdkHomeMac, undefined);
		assert.deepStrictEqual(workspaceContext.config?.flutterScript, { script: "/snap/flutter/current/flutter.sh", replacesArgs: 0 });
		logger.info("        " + JSON.stringify(workspaceContext, undefined, 8).trim().slice(1, -1).trim());
	});
});
