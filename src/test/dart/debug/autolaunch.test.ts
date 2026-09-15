import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import { debug, Uri, workspace } from "vscode";
import * as ws from "ws";
import { autoLaunchFilename } from "../../../shared/constants";
import { fsPath } from "../../../shared/utils/fs";
import { waitFor } from "../../../shared/utils/promises";
import { AutoLaunch } from "../../../shared/vscode/autolaunch";
import { defer, delay, getRandomTempFolder, helloWorldMainFile, logger, sb, tryDelete } from "../../helpers";

/// Use a unique named config folder so we don't trigger the built-in AutoLaunch for the main extension that's running.
const testDartCodeConfigFolder = ".test_dart_code";
const testDebounceDelayMs = 200; // Shorter debounce to use for faster tests.
const debounceOffset = 50; // Time to wait in addition to the debounce time.

describe.only("debug autolaunch", () => {
	for (const alreadyExists of [/* true, */ false]) {

		const groupName = alreadyExists ? "with existing file" : "with file created later";
		describe.only(groupName, () => {

			for (const overridePath of [/* testDartCodeConfigFolder, */ getRandomTempFolder()]) {
				const testName = `with config path set to "${overridePath}"`;
				it.only(testName, async () => {
					const { wf, baseUri, filePath, startDebugSession } = createTestEnvironment(overridePath);
					const launchConfig = createLaunchConfig(`${groupName} ${testName}`);

					if (alreadyExists) {
						await triggerAutoLaunch(filePath, launchConfig, overridePath);

						await waitFor(() => startDebugSession.called);
						console.warn(JSON.stringify(startDebugSession.getCalls()));
						assert.ok(startDebugSession.calledOnceWith(baseUri ? wf : undefined, launchConfig));
					} else {
						createAutoLaunchWatcher(overridePath);
						await delay(500);
						await writeAutoLaunchFile(filePath, launchConfig);

						await waitFor(() => startDebugSession.called);
						console.warn(JSON.stringify(startDebugSession.getCalls()));
						assert.ok(startDebugSession.calledOnceWith(baseUri ? wf : undefined, launchConfig));
					}
				});
			}
		});
	}

	describe("file modifications", () => {
		it("should handle file modifications", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const launchConfig = createLaunchConfig("File Modification Test");

			createAutoLaunchWatcher();

			// Create file initially with empty config.
			await writeAutoLaunchFile(filePath);
			await delay(testDebounceDelayMs + debounceOffset); // Wait for initial debounce.

			assert.ok(!startDebugSession.called, "Should not have called startDebugSession for empty config");

			// Now modify the file with a valid configuration.
			await writeAutoLaunchFile(filePath, launchConfig);

			await waitFor(() => startDebugSession.called);
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});

		it("should debounce rapid file changes", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const launchConfig1 = createLaunchConfig("Debounce Test 1");
			const launchConfig2 = createLaunchConfig("Debounce Test 2");
			const launchConfig3 = createLaunchConfig("Debounce Test 3");
			const launchConfig4 = createLaunchConfig("Debounce Test 4");

			createAutoLaunchWatcher();

			// Rapidly write multiple configs.
			await fs.promises.writeFile(filePath, JSON.stringify({ configurations: [launchConfig1] }));
			await delay(testDebounceDelayMs / 2);
			await fs.promises.writeFile(filePath, JSON.stringify({ configurations: [launchConfig2] }));
			await delay(testDebounceDelayMs / 2);
			await fs.promises.writeFile(filePath, JSON.stringify({ configurations: [launchConfig3] }));
			await delay(testDebounceDelayMs / 2);
			await fs.promises.writeFile(filePath, JSON.stringify({ configurations: [launchConfig4] }));

			// Wait for debounce a session to start, and then for the debounce time.
			await waitFor(() => startDebugSession.called);
			await delay(testDebounceDelayMs + debounceOffset);

			// Should only be called once with the final configuration.
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig4));
		});
	});

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
			// Find an available port for our mock WebSocket server.
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

			await waitFor(() => startDebugSession.called); // Don't wait long, it should connect immediately.
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});

		it("should wait for VM Service to become available after a delay", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const vmServiceUri = `ws://localhost:${serverPort}`;
			const launchConfig = createLaunchConfig("VM Service Delayed Test", vmServiceUri, 5000);

			await triggerAutoLaunch(filePath, launchConfig);
			void delay(1000).then(startMockServer);

			await waitFor(() => startDebugSession.called);
			assert.ok(startDebugSession.calledOnceWith(wf, launchConfig));
		});

		it("should fail to start debugging if VM Service never becomes available", async () => {
			const { filePath, startDebugSession } = createTestEnvironment();
			const vmServiceUri = `ws://localhost:${serverPort}`;
			const timeout = 500;
			const launchConfig = createLaunchConfig("VM Service Timeout Test", vmServiceUri, timeout);

			await triggerAutoLaunch(filePath, launchConfig);
			// Don't start the mock server - VM Service should timeout.

			await delay(timeout + 100); // Wait long enough for the timeout.
			assert.ok(!startDebugSession.called);
		});

		it("should start debugging immediately if waitForVmServiceMs is provided but vmServiceUri is not", async () => {
			const { wf, filePath, startDebugSession } = createTestEnvironment();
			const launchConfig = createLaunchConfig("No VM Service Test", undefined);

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
			? fsPath(Uri.joinPath(baseUri, overridePath))
			: overridePath
		: fsPath(Uri.joinPath(wf.uri, testDartCodeConfigFolder));
	const filePath = path.join(folderPath, autoLaunchFilename);

	console.warn(`Going to use ${folderPath} for test environment`);
	if (!fs.existsSync(folderPath)) {
		console.warn(`folderPath does not exist, so creating!`);
		fs.mkdirSync(folderPath, { recursive: true });
		console.warn(`created folderPath`);
	}
	defer(`delete ${folderPath}`, () => tryDelete(folderPath));

	const startDebugSession = sb.stub(debug, "startDebugging").callsFake(() => Promise.resolve());
	return { wf, baseUri, filePath, startDebugSession };
}

async function writeAutoLaunchFile(filePath: string, launchConfig?: any) {
	const launchConfigs = launchConfig ? { configurations: [launchConfig] } : { configurations: [] };
	await fs.promises.writeFile(filePath, JSON.stringify(launchConfigs), { flush: true });
}

function createAutoLaunchWatcher(overridePath?: string) {
	const autoLaunch = new AutoLaunch(overridePath ?? testDartCodeConfigFolder, logger, undefined, testDebounceDelayMs);
	defer("dispose AutoLaunch", () => autoLaunch.dispose());
}

async function triggerAutoLaunch(filePath: string, launchConfig?: any, overridePath?: string) {
	await writeAutoLaunchFile(filePath, launchConfig);
	await delay(10); // Small delay to ensure file exists before we create AutoLaunch (although we do flush in writeAutoLaunch).

	createAutoLaunchWatcher(overridePath);
}
