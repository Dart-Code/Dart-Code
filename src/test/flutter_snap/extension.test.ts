import { strict as assert } from "assert";
import * as os from "os";
import * as path from "path";
import * as vs from "vscode";
import { isLinux } from "../../shared/constants";
import { fsPath } from "../../shared/utils/fs";
import { activate, logger, privateApi } from "../helpers";

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
		await activate();

		const workspaceContext = privateApi.workspaceContext;

		assert.ok(workspaceContext.sdks);
		assert.ok(workspaceContext.sdks.dart);
		assert.equal(workspaceContext.sdks.flutter, `${path.join(os.homedir(), "/snap/flutter/common/flutter")}`);
		assert.equal(workspaceContext.sdks.dart, `${path.join(os.homedir(), "/snap/flutter/common/flutter/bin/cache/dart-sdk")}`);
		logger.info("        " + JSON.stringify(workspaceContext, undefined, 8).trim().slice(1, -1).trim());
	});
});
