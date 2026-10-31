import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as sinon from "sinon";
import * as url from "url";
import * as vs from "vscode";
import { getFolderToRunCommandIn } from "../../../extension/utils/vscode/projects";
import { MissingPackageMap, PackageMap, PackageMapLoader } from "../../../shared/pub/package_map";
import { fsPath, isWithinPathOrEqual } from "../../../shared/utils/fs";
import { getPubWorkspaceOrPackageFolderInfo, getPubWorkspaceStatus, promptToRunPubGet, promptToRunPubUpgrade, PubPackageStatus } from "../../../shared/vscode/pub";
import * as sharedVscodeUtils from "../../../shared/vscode/utils";
import { activate, activateWithoutAnalysis, defer, fixPath, getRandomTempFolder, helloWorldExampleSubFolder, helloWorldFolder, privateApi, sb, tryDelete } from "../../helpers";

describe("pub package status", () => {
	before("activate", () => activate());

	let workspace: WorkspaceInfo;

	it("no pubspec", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {},
		};

		expectStatus(workspace, []); // No projects found.
	});

	it("pubspec without dependencies", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 1, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Pubspec does not contain any dependencies" },
		]);
	});

	it("no package_config", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
		]);
	});

	it("package_config is stale compared to pubspec.yaml", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 100, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", triggeredByFile: "pubspec.yaml", reason: "The proj1/pubspec.yaml file was modified more recently than the proj1/.dart_tool/package_config.json file" },
		]);
	});

	it("package_config is stale compared to pubspec.lock", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj1/pubspec.lock": { mtime: 100, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", triggeredByFile: "pubspec.lock", reason: "The proj1/pubspec.lock file was modified more recently than the proj1/.dart_tool/package_config.json file" },
		]);
	});

	it("pubspec lock is stale compared to pubspec", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 3, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 2, content: "dependencies:" },
				"/projects/proj1/pubspec.lock": { mtime: 1, content: "" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", triggeredByFile: "pubspec.yaml", reason: "The proj1/pubspec.yaml file was modified more recently than the proj1/pubspec.lock file" },
		]);
	});

	it("everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("last used SDK is old (MAJOR)", async () => {
		workspace = {
			sdkVersion: "2.0.0",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "UPGRADE", reason: "The current SDK version (2.0.0) is newer than the one last used to run \"pub get\" (1.2.3)" },
		]);
	});

	it("last used SDK is old (MINOR)", async () => {
		workspace = {
			sdkVersion: "1.3.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "UPGRADE", reason: "The current SDK version (1.3.3) is newer than the one last used to run \"pub get\" (1.2.3)" },
		]);
	});

	it("last used SDK is old (PATCH)", async () => {
		workspace = {
			sdkVersion: "1.2.4",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("last used SDK is newer (MAJOR)", async () => {
		workspace = {
			sdkVersion: "1.2.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "2.0.0" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The current SDK version (1.2.3) is older than the one last used to run \"pub get\" (2.0.0)" },
		]);
	});

	it("last used SDK is newer (MINOR)", async () => {
		workspace = {
			sdkVersion: "1.2.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.3.3" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The current SDK version (1.2.3) is older than the one last used to run \"pub get\" (1.3.3)" },
		]);
	});

	it("last used SDK is newer (PATCH)", async () => {
		workspace = {
			sdkVersion: "1.2.3",
			openFolders: ["/projects/proj1"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: `{ "generatorVersion": "1.2.4" }` },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("multi-project folder, no package configs", async () => {
		workspace = {
			openFolders: ["/projects/root"],
			files: {
				"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/root/proj1", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
			{ folder: "/projects/root/proj2", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
		]);
	});

	it("multi-project folder, everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/root"],
			files: {
				"/projects/root/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/root/proj2/.dart_tool/package_config.json": { mtime: 5, content: "{}" },
				"/projects/root/proj2/pubspec.yaml": { mtime: 4, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/root/proj1", pubRequired: false, reason: "Up-to-date" },
			{ folder: "/projects/root/proj2", pubRequired: false, reason: "Up-to-date" },
		]);
	});

	it("multi-root workspace, no package configs", async () => {
		workspace = {
			openFolders: ["/projects/proj1", "/projects/proj2"],
			files: {
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj2/pubspec.yaml": { mtime: 1, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
			{ folder: "/projects/proj2", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
		]);
	});

	it("multi-root workspace, everything up-to-date", async () => {
		workspace = {
			openFolders: ["/projects/proj1", "/projects/proj2"],
			files: {
				"/projects/proj1/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
				"/projects/proj1/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				"/projects/proj2/.dart_tool/package_config.json": { mtime: 5, content: "{}" },
				"/projects/proj2/pubspec.yaml": { mtime: 4, content: "dependencies:" },
			},
		};

		expectStatus(workspace, [
			{ folder: "/projects/proj1", pubRequired: false, reason: "Up-to-date" },
			{ folder: "/projects/proj2", pubRequired: false, reason: "Up-to-date" },
		]);
	});


	for (const openOnlyChildren of [false, true]) {
		const openFolders = openOnlyChildren
			? ["/projects/root/proj1", "/projects/root/proj2", "/projects/root/proj3"]
			: ["/projects/root"];
		const name = openOnlyChildren
			? "pub workspace (only children open)"
			: "pub workspace";

		it(`${name}, no package configs`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/pubspec.yaml": { mtime: 1, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: "GET", reason: "The .dart_tool/package_config.json file is missing" },
			]);
		});

		it(`${name}, root pubspec is new`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/.dart_tool/package_config.json": { mtime: 1, content: "{}" },
					"/projects/root/pubspec.yaml": { mtime: 10, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: "GET", triggeredByFile: "pubspec.yaml", reason: "The root/pubspec.yaml file was modified more recently than the root/.dart_tool/package_config.json file" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: false, reason: "Up-to-date" },
			]);
		});

		it(`${name}, child project pubspec is new`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/.dart_tool/package_config.json": { mtime: 1, content: "{}" },
					"/projects/root/pubspec.yaml": { mtime: 1, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 10, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: "GET", triggeredByFile: "pubspec.yaml", reason: "The proj1/pubspec.yaml file was modified more recently than the root/.dart_tool/package_config.json file" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: false, reason: "Up-to-date" },
			]);
		});

		it(`${name}, everything up-to-date`, async () => {
			workspace = {
				openFolders,
				files: {
					"/projects/root/.dart_tool/package_config.json": { mtime: 10, content: "{}" },
					"/projects/root/pubspec.yaml": { mtime: 1, content: "workspace:\n- proj1\n- proj2" },
					"/projects/root/proj1/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					"/projects/root/proj2/pubspec.yaml": { mtime: 1, content: "resolution: workspace\ndependencies:" },
					// proj3 is not part of the workspace
					"/projects/root/proj3/.dart_tool/package_config.json": { mtime: 2, content: "{}" },
					"/projects/root/proj3/pubspec.yaml": { mtime: 1, content: "dependencies:" },
				},
			};

			expectStatus(workspace, [
				{ folder: "/projects/root", pubRequired: false, reason: "Up-to-date" },
				{ folder: "/projects/root/proj1", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj2", pubRequired: false, reason: "The project is part of a Pub workspace" },
				{ folder: "/projects/root/proj3", pubRequired: false, reason: "Up-to-date" },
			]);
		});
	}

	function expectStatus(workspace: WorkspaceInfo, expectedStatuses: Array<{ folder: string, pubRequired: false | "GET" | "UPGRADE", triggeredByFile?: "pubspec.yaml" | "pubspec.lock", reason?: string }>) {
		workspace.openFolders = workspace.openFolders.map(fixPath);
		const fixedFiles: typeof workspace.files = {};
		for (const p of Object.keys(workspace.files))
			fixedFiles[fixPath(p)] = workspace.files[p];
		workspace.files = fixedFiles;
		expectedStatuses = expectedStatuses.map((s) => ({ ...s, folder: fixPath(s.folder) }));

		const files = workspace.files;
		const existsSync = (f: string) => !!files[f];
		const mtimeSync = (f: string) => { if (files[f] !== undefined) return new Date(files[f].mtime); else throw new Error("No file"); };
		const readFileSync = (f: string) => { if (files[f]?.content !== undefined) return files[f].content; else throw new Error("No file/content"); };

		// Project folders are anything from the openFolders and below that contain pubspecs
		// according to files.
		const foldersWithPubspecs = Object.keys(workspace.files).filter((p) => p.endsWith("pubspec.yaml")).map((p) => p.substring(0, p.length - 13));
		const projectFolders = foldersWithPubspecs.filter((p) => workspace.openFolders.find((wf) => isWithinPathOrEqual(p, wf)));

		const results = getPubWorkspaceStatus(
			{
				dartSdkIsFromFlutter: false,
				dartVersion: workspace.sdkVersion ?? "1.2.3",
				isPreReleaseSdk: false,
			},
			privateApi.logger,
			projectFolders.map((p) => vs.Uri.file(p)),
			false,
			existsSync,
			readFileSync,
			mtimeSync,
		).map((result) => {
			// Tests use folder paths instead of URIs
			const newResult = ({ ...result, folderUri: undefined, folder: fsPath(result.folderUri), workspace: undefined });
			delete newResult.folderUri;
			// And for convenience we don't check the root flag because the other data is based on it.
			delete newResult.workspace;
			return newResult;
		});

		results.sort((a, b) => a.folder.localeCompare(b.folder));
		expectedStatuses.sort((a, b) => a.folder.localeCompare(b.folder));
		assert.deepStrictEqual(results, expectedStatuses);
	}
});

describe("pub package commands", () => {
	before("activate", () => activate());

	const currentWorkspaceRoot = fsPath(vs.workspace.workspaceFolders![0].uri);
	let tempRoot: string;
	let workspaceRoot: string;
	let workspaceProject1: string;
	let workspaceProject2: string;
	let standalone1: string;
	let standalone2: string;

	beforeEach("Set up workspace project", () => {
		tempRoot = path.join(currentWorkspaceRoot, "temp", `pub_get_all_test_${Date.now()}`);
		defer("clean up temp test projects", () => tryDelete(tempRoot));

		workspaceRoot = path.join(tempRoot, "workspace_root");
		workspaceProject1 = path.join(workspaceRoot, "proj1");
		workspaceProject2 = path.join(workspaceRoot, "proj2");
		standalone1 = path.join(tempRoot, "standalone1");
		standalone2 = path.join(tempRoot, "standalone2");

		const write = (filePath: string, content: string) => {
			fs.mkdirSync(path.dirname(filePath), { recursive: true });
			fs.writeFileSync(filePath, content);
		};

		write(path.join(workspaceRoot, "pubspec.yaml"), "workspace:\n- proj1\n- proj2");
		write(path.join(workspaceProject1, "pubspec.yaml"), "resolution: workspace\ndependencies:");
		write(path.join(workspaceProject2, "pubspec.yaml"), "resolution: workspace\ndependencies:");
		write(path.join(standalone1, "pubspec.yaml"), "dependencies:");
		write(path.join(standalone2, "pubspec.yaml"), "dependencies:");

		// Clear caches in case another test recently cached the package results.
		privateApi.clearCaches();
	});

	const packageCommandTestConfigs = [
		{
			commandName: "dart.getPackages",
			methodName: "getPackagesForUri",
		},
		{
			commandName: "dart.upgradePackages",
			methodName: "upgradePackagesForUri",
		},
	] as const;

	for (const { commandName, methodName } of packageCommandTestConfigs) {
		/**
		 * Verifies that when executing the command `commandName` with `inputPaths`, that the packageCommands
		 * method `methodName` is executed exactly once for each of `expectedPaths`.
		 */
		async function verifyCommandInvocationPaths(
			inputPaths: string | vs.Uri | vs.Uri[],
			expectedPaths: string[],
			commandToExecute: string = commandName,
		) {
			const packageCommandForUri = sb.stub(privateApi.packageCommands, methodName).callThrough();
			const packageCommandForUriCall = packageCommandForUri.withArgs(sinon.match.any).resolves();

			await vs.commands.executeCommand(commandToExecute, inputPaths);

			assert.ok(packageCommandForUriCall.called);
			const actualPaths = packageCommandForUriCall.getCalls()
				.map((call) => fsPath(call.args[0] as vs.Uri))
				// Filter out entries outside of our test project, because "Get for all" will also trigger the
				// main workspace.
				.filter((p) => p.startsWith(tempRoot));
			assert.deepStrictEqual(actualPaths.sort(), expectedPaths.sort());
		}

		describe(commandName, () => {
			it(`works with a single project folder path`, async () => {
				await verifyCommandInvocationPaths(
					standalone1,
					[standalone1],
				);
			});

			it(`works with a single project pubspec file path`, async () => {
				await verifyCommandInvocationPaths(
					path.join(standalone1, "pubspec.yaml"),
					[standalone1],
				);
			});

			it(`works with a single project folder uri`, async () => {
				await verifyCommandInvocationPaths(
					vs.Uri.file(standalone1),
					[standalone1],
				);
			});

			it(`works with a single project pubspec file uri`, async () => {
				await verifyCommandInvocationPaths(
					vs.Uri.file(path.join(standalone1, "pubspec.yaml")),
					[standalone1],
				);
			});

			it(`works with an array`, async () => {
				const uris = [
					vs.Uri.file(path.join(standalone1, "pubspec.yaml")),
					vs.Uri.file(path.join(standalone2)),
					vs.Uri.file(path.join(workspaceProject1)),
				];
				await verifyCommandInvocationPaths(
					uris,
					[standalone1, standalone2, workspaceRoot],
				);
			});

			if (commandName === "dart.getPackages") {
				it(`"...for All Projects" runs pub once per workspace root and once per standalone package`, async () => {
					await verifyCommandInvocationPaths(
						[],
						[standalone1, standalone2, workspaceRoot],
						"dart.getPackages.all"
					);
				});
			}
		});
	}

	describe("package picker", () => {
		beforeEach("activate without an open file", () => activateWithoutAnalysis(null));

		it("collapses pub workspace projects into a single picker entry with a package count", async () => {
			const openFolders = ["/projects/root/proj1", "/projects/root/proj2", "/projects/standalone"].map(fixPath);
			const files: FilesInfo = {};

			files[fixPath("/projects/root/pubspec.yaml")] = { mtime: 1, content: "workspace:\n- proj1\n- proj2" };
			files[fixPath("/projects/root/proj1/pubspec.yaml")] = { mtime: 1, content: "resolution: workspace\ndependencies:" };
			files[fixPath("/projects/root/proj2/pubspec.yaml")] = { mtime: 1, content: "resolution: workspace\ndependencies:" };
			files[fixPath("/projects/standalone/pubspec.yaml")] = { mtime: 1, content: "dependencies:" };

			const results = getPubWorkspaceOrPackageFolderInfo(
				openFolders,
				(filePath) => !!files[filePath],
				(filePath) => {
					const file = files[filePath];
					if (!file)
						throw new Error("No file/content");
					return file.content;
				},
			);

			assert.deepStrictEqual(results, [
				{ path: fixPath("/projects/root"), workspacePackageCount: 2 },
				{ path: fixPath("/projects/standalone") },
			]);
		});

		it("shows each pub workspace only once with a package count suffix", async () => {
			sb.stub(sharedVscodeUtils, "getAllProjectFolders").resolves([workspaceProject1, workspaceProject2, standalone1]);
			const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves({ path: workspaceRoot });

			const folder = await getFolderToRunCommandIn(privateApi.logger, "Select which folder to get packages for", { onlyShowWorkspaceRoots: true });

			assert.ok(showQuickPick.calledOnce);
			const workspaceFolder = vs.workspace.getWorkspaceFolder(vs.Uri.file(workspaceRoot));
			assert.ok(workspaceFolder);
			const workspacePathParent = path.dirname(fsPath(workspaceFolder.uri));
			const items = showQuickPick.firstCall.args[0] as Array<vs.QuickPickItem & { path: string }>;
			assert.deepStrictEqual(items.map((item) => ({ label: item.label, detail: item.detail, path: item.path })), [
				{ label: path.relative(workspacePathParent, standalone1), detail: undefined, path: standalone1 },
				{ label: path.relative(workspacePathParent, workspaceRoot), detail: "Pub Workspace, 2 packages", path: workspaceRoot },
			]);
			assert.equal(folder, workspaceRoot);
		});

		it("includes a pub workspace root that is outside opened workspace folders", async () => {
			sb.stub(sharedVscodeUtils, "getAllProjectFolders").resolves([workspaceProject1, workspaceProject2, standalone1]);
			const getWorkspaceFolder = sb.stub(vs.workspace, "getWorkspaceFolder").callsFake((uri: vs.Uri) => {
				const folderPath = fsPath(uri);
				if (folderPath === workspaceRoot)
					return undefined;
				if (folderPath === standalone1)
					return { index: 0, name: path.basename(standalone1), uri: vs.Uri.file(standalone1) };
				return undefined;
			});
			const showQuickPick = sb.stub(vs.window, "showQuickPick").resolves({ path: workspaceRoot });

			const folder = await getFolderToRunCommandIn(privateApi.logger, "Select which folder to get packages for", { onlyShowWorkspaceRoots: true });

			assert.ok(getWorkspaceFolder.called);
			assert.ok(showQuickPick.calledOnce);
			const items = showQuickPick.firstCall.args[0] as Array<vs.QuickPickItem & { path: string }>;
			assert.deepStrictEqual(items.map((item) => ({ label: item.label, detail: item.detail, path: item.path })), [
				{ label: path.basename(standalone1), detail: undefined, path: standalone1 },
				{ label: path.basename(workspaceRoot), detail: "Pub Workspace, 2 packages", path: workspaceRoot },
			]);
			assert.equal(folder, workspaceRoot);
		});

		it("does not prompt if all discovered projects collapse to a single pub workspace", async () => {
			sb.stub(sharedVscodeUtils, "getAllProjectFolders").resolves([workspaceProject1, workspaceProject2]);
			const showQuickPick = sb.stub(vs.window, "showQuickPick");

			const folder = await getFolderToRunCommandIn(privateApi.logger, "Select which folder to get packages for", { onlyShowWorkspaceRoots: true });

			assert.equal(showQuickPick.called, false);
			assert.equal(folder, workspaceRoot);
		});
	});

	describe("pub prompts", () => {
		let showInformationMessage: sinon.SinonStub;

		beforeEach("set up showInformationMessage stub", () => {
			showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);
		});

		function makeStatus(folderUri: vs.Uri, pubRequired: "GET" | "UPGRADE", triggeredByFile?: "pubspec.yaml" | "pubspec.lock"): PubPackageStatus {
			return { folderUri, pubRequired, triggeredByFile, workspace: "NONE" };
		}

		it("shows general message for single project when reason is not a specific file modification", async () => {
			await promptToRunPubGet([makeStatus(helloWorldFolder, "GET")]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"Some packages are missing or out of sync for package:hello_world, would you like to fetch them now?",
			);
		});

		it("shows general message for two projects", async () => {
			await promptToRunPubGet([
				makeStatus(helloWorldFolder, "GET"),
				makeStatus(helloWorldExampleSubFolder, "GET"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"Some packages are missing or out of sync for package:hello_world (+ 1 other), would you like to fetch them now?",
			);
		});

		it("shows general message for three projects", async () => {
			await promptToRunPubGet([
				makeStatus(helloWorldFolder, "GET"),
				makeStatus(helloWorldExampleSubFolder, "GET"),
				makeStatus(vs.Uri.file(standalone1), "GET"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"Some packages are missing or out of sync for package:hello_world (+ 2 others), would you like to fetch them now?",
			);
		});

		it("shows pubspec.yaml message when all projects were triggered by pubspec.yaml", async () => {
			await promptToRunPubGet([
				makeStatus(helloWorldFolder, "GET", "pubspec.yaml"),
				makeStatus(helloWorldExampleSubFolder, "GET", "pubspec.yaml"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"pubspec.yaml was modified recently in package:hello_world (+ 1 other), would you like to fetch updated packages?",
			);
		});

		it("shows pubspec.lock message when all projects were triggered by pubspec.lock", async () => {
			await promptToRunPubGet([
				makeStatus(helloWorldFolder, "GET", "pubspec.lock"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"pubspec.lock was modified recently in package:hello_world, would you like to fetch updated packages?",
			);
		});

		it("shows general message when projects have mixed triggers", async () => {
			await promptToRunPubGet([
				makeStatus(helloWorldFolder, "GET", "pubspec.yaml"),
				makeStatus(helloWorldExampleSubFolder, "GET", "pubspec.lock"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"Some packages are missing or out of sync for package:hello_world (+ 1 other), would you like to fetch them now?",
			);
		});

		it("shows SDK upgrade message with project summary", async () => {
			await promptToRunPubUpgrade([
				makeStatus(helloWorldFolder, "UPGRADE"),
				makeStatus(helloWorldExampleSubFolder, "UPGRADE"),
				makeStatus(vs.Uri.file(standalone1), "UPGRADE"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"Your SDK has been updated since you last fetched packages for package:hello_world (+ 2 others), would you like to fetch updated packages?",
			);
		});

		it("prioritizes an UPGRADE project in the SDK upgrade message when preceded by GET projects", async () => {
			await promptToRunPubUpgrade([
				makeStatus(helloWorldFolder, "GET"),
				makeStatus(helloWorldExampleSubFolder, "UPGRADE"),
				makeStatus(vs.Uri.file(standalone1), "GET"),
			]);
			assert.equal(showInformationMessage.calledOnce, true);
			assert.equal(
				showInformationMessage.firstCall.args[0],
				"Your SDK has been updated since you last fetched packages for package:hello_world_example (example) (+ 2 others), would you like to fetch updated packages?",
			);
		});
	});
});

describe("package map", () => {
	before("activate", () => activate());

	let tempFolder: string;
	let packageConfigPath: string;

	beforeEach("create temp folder", () => {
		tempFolder = getRandomTempFolder();
		defer("clean up temp folder", () => tryDelete(tempFolder));
		packageConfigPath = path.join(tempFolder, ".dart_tool", "package_config.json");
	});

	function writePackageConfig(content: string | object) {
		fs.mkdirSync(path.dirname(packageConfigPath), { recursive: true });
		fs.writeFileSync(
			packageConfigPath,
			typeof content === "string" ? content : JSON.stringify(content),
		);
	}

	describe("findPackagesFile", () => {
		it("returns undefined for empty or undefined entryPoint", () => {
			assert.equal(PackageMap.findPackagesFile(undefined), undefined);
			assert.equal(PackageMap.findPackagesFile(""), undefined);
		});

		it("returns undefined when no package_config.json exists in ancestors", () => {
			assert.equal(PackageMap.findPackagesFile(tempFolder), undefined);
		});

		it("finds package_config.json in project root or ancestor", () => {
			writePackageConfig({ configVersion: 2, packages: [] });
			const subFolder = path.join(tempFolder, "lib", "src");
			fs.mkdirSync(subFolder, { recursive: true });

			assert.equal(PackageMap.findPackagesFile(tempFolder), packageConfigPath);
			assert.equal(PackageMap.findPackagesFile(subFolder), packageConfigPath);
		});
	});

	describe("MissingPackageMap", () => {
		it("returns empty packages, undefined paths/URIs, and no-op reload", () => {
			const map = new MissingPackageMap();
			assert.deepStrictEqual(map.packages, {});
			assert.equal(map.getPackagePath("foo"), undefined);
			assert.equal(map.resolvePackageUri("package:foo/bar.dart"), undefined);
			assert.equal(map.flutterRootPath, undefined);
			map.reload();
			assert.deepStrictEqual(map.packages, {});
		});

		it("is returned by load when file is undefined or cannot be read", () => {
			const undefinedMap = PackageMap.load(privateApi.logger, undefined);
			assert.deepStrictEqual(undefinedMap.packages, {});
			assert.equal(undefinedMap.getPackagePath("foo"), undefined);

			const errorSpy = sb.spy(privateApi.logger, "error");
			const missingFileMap = PackageMap.load(privateApi.logger, path.join(tempFolder, "non_existent.json"));
			assert.ok(errorSpy.calledOnce);
			assert.deepStrictEqual(missingFileMap.packages, {});
			assert.equal(missingFileMap.resolvePackageUri("package:foo/bar.dart"), undefined);
		});

		it("is returned by loadForProject when no package_config.json exists or when load throws", () => {
			const loader = new PackageMapLoader(privateApi.logger);
			const missingMap = loader.loadForProject(tempFolder);
			assert.deepStrictEqual(missingMap.packages, {});
			assert.equal(missingMap.getPackagePath("foo"), undefined);

			writePackageConfig({ configVersion: 2, packages: [] });
			const warnSpy = sb.spy(privateApi.logger, "warn");
			sb.stub(PackageMap, "load").throws(new Error("simulated load failure"));

			const errorMap = PackageMap.loadForProject(privateApi.logger, tempFolder);
			assert.ok(warnSpy.calledOnce);
			assert.ok(String(warnSpy.firstCall.args[0]).includes("Failed to load package map"));
			assert.deepStrictEqual(errorMap.packages, {});
		});
	});

	describe("resolvePackageUri and getPackagePath", () => {
		it("resolves package:foo/bar.dart and foo/bar.dart to the file path on disk", () => {
			const fooLibDir = path.join(tempFolder, "packages", "foo", "lib");
			writePackageConfig({
				configVersion: 2,
				packages: [
					{
						name: "foo",
						packageUri: "lib/",
						rootUri: url.pathToFileURL(path.join(tempFolder, "packages", "foo")).toString(),
					},
				],
			});

			const loader = new PackageMapLoader(privateApi.logger);
			const map = loader.loadForProject(tempFolder);

			assert.equal(map.getPackagePath("foo"), fooLibDir);
			assert.equal(map.getPackagePath("unknown"), undefined);
			assert.equal(map.resolvePackageUri("package:foo/bar.dart"), path.join(fooLibDir, "bar.dart"));
			assert.equal(map.resolvePackageUri("foo/bar.dart"), path.join(fooLibDir, "bar.dart"));
			assert.equal(map.resolvePackageUri("package:foo/src/nested/baz.dart"), path.join(fooLibDir, "src", "nested", "baz.dart"));
			assert.equal(PackageMap.prototype.getPackagePath.call(map, "foo"), fooLibDir);
			assert.equal(PackageMap.prototype.getPackagePath.call(map, "unknown"), undefined);
		});

		it("returns undefined for empty strings, URIs without slash, or unknown packages", () => {
			writePackageConfig({
				configVersion: 2,
				packages: [
					{
						name: "foo",
						packageUri: "lib/",
						rootUri: "../foo",
					},
				],
			});

			const map = PackageMap.load(privateApi.logger, packageConfigPath);

			assert.equal(map.resolvePackageUri(""), undefined);
			assert.equal(map.resolvePackageUri("package:foo"), undefined);
			assert.equal(map.resolvePackageUri("foo"), undefined);
			assert.equal(map.resolvePackageUri("package:unknown/bar.dart"), undefined);
			assert.equal(map.resolvePackageUri("unknown/bar.dart"), undefined);
		});
	});

	describe("PackageConfigJsonPackageMap edge cases", () => {
		it("logs a warning and initializes an empty map on malformed JSON without throwing", () => {
			writePackageConfig("{ malformed json");
			const warnSpy = sb.spy(privateApi.logger, "warn");

			const map = PackageMap.load(privateApi.logger, packageConfigPath);

			assert.ok(warnSpy.calledOnce);
			assert.ok(String(warnSpy.firstCall.args[0]).includes("Failed to load package map"));
			assert.deepStrictEqual(map.packages, {});
			assert.equal(map.getPackagePath("foo"), undefined);
			assert.equal(map.flutterRootPath, undefined);
		});

		it("clears packages and flutterRootPath when reload() encounters malformed JSON", () => {
			const fooDir = path.join(tempFolder, "foo");
			const flutterSdkDir = path.join(tempFolder, "flutter_sdk");
			writePackageConfig({
				configVersion: 2,
				flutterRoot: url.pathToFileURL(flutterSdkDir).toString(),
				packages: [
					{
						name: "foo",
						packageUri: "lib/",
						rootUri: url.pathToFileURL(fooDir).toString(),
					},
				],
			});

			const map = PackageMap.load(privateApi.logger, packageConfigPath);
			assert.deepStrictEqual(map.packages, { foo: path.join(fooDir, "lib") });
			assert.equal(map.flutterRootPath, `${flutterSdkDir}${path.sep}`);

			const warnSpy = sb.spy(privateApi.logger, "warn");
			writePackageConfig("{ malformed json");
			map.reload();

			assert.ok(warnSpy.calledOnce);
			assert.ok(String(warnSpy.firstCall.args[0]).includes("Failed to load package map"));
			assert.deepStrictEqual(map.packages, {});
			assert.equal(map.getPackagePath("foo"), undefined);
			assert.equal(map.flutterRootPath, undefined);
		});

		it("re-reads package_config.json on reload()", () => {
			const fooDir = path.join(tempFolder, "foo");
			const barDir = path.join(tempFolder, "bar");
			writePackageConfig({
				configVersion: 2,
				packages: [
					{
						name: "foo",
						packageUri: "lib/",
						rootUri: url.pathToFileURL(fooDir).toString(),
					},
				],
			});

			const map = PackageMap.load(privateApi.logger, packageConfigPath);
			assert.deepStrictEqual(map.packages, { foo: path.join(fooDir, "lib") });

			writePackageConfig({
				configVersion: 2,
				packages: [
					{
						name: "bar",
						packageUri: "lib/",
						rootUri: url.pathToFileURL(barDir).toString(),
					},
				],
			});
			map.reload();

			assert.deepStrictEqual(map.packages, { bar: path.join(barDir, "lib") });
			assert.equal(map.getPackagePath("foo"), undefined);
			assert.equal(map.getPackagePath("bar"), path.join(barDir, "lib"));
		});

		it("extracts and normalizes flutterRoot when present, or returns undefined when absent", () => {
			writePackageConfig({
				configVersion: 2,
				packages: [],
			});

			const map = PackageMap.load(privateApi.logger, packageConfigPath);
			assert.equal(map.flutterRootPath, undefined);

			const flutterSdkDir = path.join(tempFolder, "flutter_sdk");
			writePackageConfig({
				configVersion: 2,
				flutterRoot: url.pathToFileURL(flutterSdkDir).toString(),
				packages: [],
			});
			map.reload();

			assert.equal(map.flutterRootPath, `${flutterSdkDir}${path.sep}`);
		});

		it("handles file:// URIs, relative percent-encoded URIs, and invalid file:// URIs", () => {
			const filePkgDir = path.join(tempFolder, "file_pkg");
			const warnSpy = sb.spy(privateApi.logger, "warn");
			const errorSpy = sb.spy(privateApi.logger, "error");

			writePackageConfig({
				configVersion: 2,
				packages: [
					{
						name: "file_pkg",
						packageUri: "lib",
						rootUri: `${url.pathToFileURL(filePkgDir).toString()}/`,
					},
					{
						name: "relative_encoded_pkg",
						packageUri: "src%20dir/",
						rootUri: "../my%20pkg",
					},
					{
						name: "empty_pkg_uri",
						packageUri: "",
						rootUri: "../root_only",
					},
					{
						name: "invalid_file_uri_pkg",
						packageUri: "lib/",
						rootUri: "file://:invalid",
					},
				],
			});

			const map = PackageMap.load(privateApi.logger, packageConfigPath);

			assert.equal(map.getPackagePath("file_pkg"), path.join(filePkgDir, "lib"));
			assert.equal(map.getPackagePath("relative_encoded_pkg"), path.join(tempFolder, "my pkg", "src dir"));
			assert.equal(map.getPackagePath("empty_pkg_uri"), path.join(tempFolder, "root_only"));
			assert.equal(map.getPackagePath("invalid_file_uri_pkg"), undefined);

			assert.ok(warnSpy.calledOnce);
			assert.ok(String(warnSpy.firstCall.args[0]).includes("Failed to extract path from URI: file://:invalid"));
			assert.ok(errorSpy.calledOnce);
			assert.ok(String(errorSpy.firstCall.args[0]).includes("Failed to resolve path for package invalid_file_uri_pkg"));
		});
	});
});

interface WorkspaceInfo {
	openFolders: string[],
	sdkVersion?: string,
	files: FilesInfo,
}

type FilesInfo = Record<string, FileInfo>;

interface FileInfo {
	mtime: number,
	content: string,
}
