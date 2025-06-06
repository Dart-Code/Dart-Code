import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { debug, Uri, workspace } from "vscode";
import { autoLaunchFilename, defaultDartCodeConfigurationPath } from "../../../shared/constants";
import { fsPath, tryDeleteFile } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { AutoLaunch } from "../../../shared/vscode/autolaunch";
import { defer, delay, getRandomTempFolder, helloWorldMainFile, logger, sb } from "../../helpers";

describe("debug autolaunch", () => {
	for (const alreadyExists of [true, false]) {

		const groupName = alreadyExists ? "with existing file" : "with file created later";
		describe(groupName, () => {

			for (const overridePath of [".test_dart_code", getRandomTempFolder()]) {
				const wf = workspace.workspaceFolders![0];
				const baseUri = path.isAbsolute(overridePath) ? undefined : wf.uri;
				const folderPath = baseUri
					? fsPath(Uri.joinPath(baseUri, overridePath ?? defaultDartCodeConfigurationPath))
					: overridePath;
				fs.mkdirSync(folderPath, { recursive: true });
				const filePath = path.join(folderPath, autoLaunchFilename);

				const testName = `with config path set to "${overridePath}" (${filePath})`;
				it(testName, async () => {
					defer(`delete ${filePath}`, () => tryDeleteFile(filePath));
					const startDebugSession = sb.stub(debug, "startDebugging").callsFake(() => Promise.resolve());

					const launchConfig = {
						// Make a unique launch config (name) so we can verify the correct config was passed to launch.
						name: `${groupName} ${testName}`,
						program: fsPath(helloWorldMainFile),
						request: "launch",
						type: "dart",
					};
					const launchConfigs = { configurations: [launchConfig] };

					if (alreadyExists) {
						await fs.promises.writeFile(filePath, JSON.stringify(launchConfigs));
					}
					const autoLaunch = new AutoLaunch(overridePath, logger, undefined);
					if (!alreadyExists) {
						await delay(500);
						await fs.promises.writeFile(filePath, JSON.stringify(launchConfigs));
					}

					await waitFor(() => startDebugSession.called);
					assert.ok(startDebugSession.calledOnceWith(baseUri ? wf : undefined, launchConfig));

					await autoLaunch.dispose();
				});
			}
		});
	}
});
