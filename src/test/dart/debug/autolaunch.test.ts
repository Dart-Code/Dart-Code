import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { debug, Uri, workspace } from "vscode";
import * as ws from "ws";
import { autoLaunchFilename, defaultDartCodeConfigurationPath } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { AutoLaunch } from "../../../shared/vscode/autolaunch";
import { defer, delay, getRandomTempFolder, helloWorldMainFile, logger, sb, tryDeleteDirectoryRecursive } from "../../helpers";

/// Use a unique named config folder so we don't trigger the built-in AutoLaunch for the main extension that's running.
const testDartCodeConfigFolder = ".test_dart_code";

describe("debug autolaunch", () => {
	for (const alreadyExists of [true, false]) {

		const groupName = alreadyExists ? "with existing file" : "with file created later";
		describe(groupName, () => {

			for (const overridePath of [testDartCodeConfigFolder, getRandomTempFolder()]) {
				const testName = `with config path set to "${overridePath}"`;
				it(testName, async () => {
					const { wf, baseUri, filePath, startDebugSession } = createTestEnvironment(overridePath);
					const launchConfig = createLaunchConfig(`${groupName} ${testName}`);

					if (alreadyExists) {
						await triggerAutoLaunch(filePath, launchConfig, overridePath);
						await waitFor(() => startDebugSession.called);
						assert.ok(startDebugSession.calledOnceWith(baseUri ? wf : undefined, launchConfig));
					} else {
						createAutoLaunch(overridePath);
						await delay(500);

						const launchConfigs = { configurations: [launchConfig] };
						await fs.promises.writeFile(filePath, JSON.stringify(launchConfigs));

						await waitFor(() => startDebugSession.called);
						assert.ok(startDebugSession.calledOnceWith(baseUri ? wf : undefined, launchConfig));
					}
				});
			}
		});
	}

	describe("VM Service probing", () => {
		let mockServer: ws.WebSocketServer | undefined;
		let serverPort: number;

		async function startMockServer() {
			mockServer = new ws.WebSocketServer({ port: serverPort });
			await new Promise<void>((resolve) => {
				mockServer!.on("listening", () => resolve());
			});
		}

		beforeEach(async () => {
			// Find an available port for our mock WebSocket server
			serverPort = await new Promise<number>((resolve) => {
				const server = new ws.WebSocketServer({ port: 0 });
				server.on("listening", () => {
					const address = server.address();
					const port = typeof address === "object" && address ? address.port : 0;
					server.close(() => resolve(port));
				});
			});
		});

		afterEach(async () => {
			if (mockServer) {
				await new Promise<void>((resolve) => {
					mockServer!.close(() => resolve());
				});
				mockServer = undefined;
			}
		});

		it("should handle already existing VM Service", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const vmServiceUri = `ws://localhost:${serverPort}`;
			const launchConfig = createLaunchConfig("VM Service Test", vmServiceUri, 5000);

			await startMockServer();
			await triggerAutoLaunch(filePath, launchConfig);

			await waitFor(() => startDebugSession.called, 1000); // Don't wait long, it should connect immediately.
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});

		it("should wait for VM Service to become available after a delay", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const vmServiceUri = `ws://localhost:${serverPort}`;
			const launchConfig = createLaunchConfig("VM Service Delayed Test", vmServiceUri, 5000);

			await triggerAutoLaunch(filePath, launchConfig);
			void delay(2000).then(startMockServer);

			await waitFor(() => startDebugSession.called, 5000);
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});

		it("should fail to start debugging if VM Service never becomes available", async () => {
			const { filePath, startDebugSession } = createTestEnvironment();
			const vmServiceUri = `ws://localhost:${serverPort}`;
			const launchConfig = createLaunchConfig("VM Service Timeout Test", vmServiceUri, 2000);

			await triggerAutoLaunch(filePath, launchConfig);
			// Don't start the mock server - VM Service should timeout

			await delay(4000); // Wait long enough for the timeout.
			assert.ok(!startDebugSession.called);
		});

		it("should start debugging immediately if waitForVmServiceMs is provided but vmServiceUri is not", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const launchConfig = createLaunchConfig("No VM Service Test", undefined,);

			await triggerAutoLaunch(filePath, launchConfig);

			await waitFor(() => startDebugSession.called);
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});

		it("should start debugging immediately if vmServiceUri is provided but waitForVmServiceMs is not", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const vmServiceUri = `ws://localhost:${serverPort}`;
			const launchConfig = createLaunchConfig("VM Service No Timeout Test", vmServiceUri);

			await triggerAutoLaunch(filePath, launchConfig);

			await waitFor(() => startDebugSession.called);
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});
	});
});

function createLaunchConfig(name: string, vmServiceUri?: string, waitForVmServiceMs?: number) {
	return ({
		name,
		program: fsPath(helloWorldMainFile),
		request: vmServiceUri ? "attach" : "launch",
		type: "dart",
		...(vmServiceUri && { vmServiceUri }),
		...(waitForVmServiceMs && { waitForVmServiceMs }),
	});
}

function createTestEnvironment(overridePath?: string) {
	const wf = workspace.workspaceFolders![0];
	const baseUri = overridePath
		? path.isAbsolute(overridePath) ? undefined : wf.uri
		: undefined;
	const folderPath = overridePath
		? baseUri
			? fsPath(Uri.joinPath(baseUri, overridePath ?? defaultDartCodeConfigurationPath))
			: overridePath
		: fsPath(Uri.joinPath(wf.uri, testDartCodeConfigFolder));
	const filePath = path.join(folderPath, autoLaunchFilename);

	fs.mkdirSync(folderPath, { recursive: true });
	defer(`delete ${folderPath}`, () => tryDeleteDirectoryRecursive(folderPath));

	const startDebugSession = sb.stub(debug, "startDebugging").callsFake(() => Promise.resolve());
	return { wf, baseUri, filePath, startDebugSession };
}

async function triggerAutoLaunch(filePath: string, launchConfig: any, overridePath?: string) {
	const launchConfigs = { configurations: [launchConfig] };
	await fs.promises.writeFile(filePath, JSON.stringify(launchConfigs));
	await delay(100); // Small delay to ensure file exists before we create AutoLaunch.

	createAutoLaunch(overridePath);
}

function createAutoLaunch(overridePath?: string) {
	const autoLaunch = new AutoLaunch(overridePath ?? testDartCodeConfigFolder, logger, undefined);
	defer("dispose AutoLaunch", () => autoLaunch.dispose());
}
