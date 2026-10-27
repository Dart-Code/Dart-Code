import { strict as assert } from "assert";
import * as path from "path";
import * as vs from "vscode";
import { runAnywayAction, showErrorsAction } from "../../shared/constants";
import { DebuggerType } from "../../shared/enums";
import { getPackageTestCapabilitiesForDartProject } from "../../shared/test/version";
import { fsPath } from "../../shared/utils/fs";
import { activate, closeAllOpenFiles, createTempPubPackage, createTempTestFile, defer, ensureArrayContainsArray, flutterHelloWorldMainFile, getAttachConfiguration, getRandomTempFolder, getResolvedDebugConfiguration, helloWorldFolder, helloWorldMainFile, helloWorldTestMainFile, openFile, privateApi, sb, setConfigForTest, tryDelete, webHelloWorldFolder } from "../helpers";

describe("dart cli debugger", () => {
	before("activate", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("sets default type, request, and unique ID in resolveDebugConfiguration", async () => {
			const resolvedConfig1 = await privateApi.debugProvider.resolveDebugConfiguration!(vs.workspace.workspaceFolders![0], {} as vs.DebugConfiguration);
			const resolvedConfig2 = await privateApi.debugProvider.resolveDebugConfiguration!(vs.workspace.workspaceFolders![0], {} as vs.DebugConfiguration);

			assert.ok(resolvedConfig1);
			assert.equal(resolvedConfig1.type, "dart");
			assert.equal(resolvedConfig1.request, "launch");
			assert.ok(resolvedConfig1.dartCodeDebugSessionID);

			assert.ok(resolvedConfig2);
			assert.ok(resolvedConfig2.dartCodeDebugSessionID);
			assert.notEqual(resolvedConfig1.dartCodeDebugSessionID, resolvedConfig2.dartCodeDebugSessionID);
		});

		it("using users explicit cwd with an explicit program", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				cwd: "/foo",
				name: undefined,
				program: fsPath(helloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.name, "Dart");
			assert.equal(resolvedConfig.cwd, "/foo");
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
		});

		it("resolves relative cwd and program and locates nested project root", async () => {
			// Relative cwd and program should be resolved against the workspace folder.
			const relativeConfig = await getResolvedDebugConfiguration({
				cwd: "example",
				program: "bin/main.dart",
			});

			assert.ok(relativeConfig);
			assert.equal(relativeConfig.cwd, path.join(fsPath(helloWorldFolder), "example"));
			assert.equal(relativeConfig.program, path.join(fsPath(helloWorldFolder), "example", "bin", "main.dart"));

			// When cwd is omitted and program is inside a nested project (example), cwd should be set to the nested project root.
			const nestedConfig = await getResolvedDebugConfiguration({
				program: path.join(fsPath(helloWorldFolder), "example", "bin", "main.dart"),
			});

			assert.ok(nestedConfig);
			assert.equal(nestedConfig.cwd, path.join(fsPath(helloWorldFolder), "example"));
		});

		it("using open file", async () => {
			defer("close open files", () => closeAllOpenFiles());
			await openFile(helloWorldMainFile);
			const resolvedConfig = await getResolvedDebugConfiguration({ program: undefined });

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
		});

		it("passing launch.json's toolArgs to the VM", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
				toolArgs: ["--fake-flag"],
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(helloWorldMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-flag"]);
		});

		it("when cliAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "cliAdditionalArgs", ["--my-vm-flag"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--my-vm-flag"]);
		});

		it("warns and returns null when program or cwd has unresolved variables", async () => {
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

			// Returning null tells VS Code to open launch.json.
			const resolvedProgram = await getResolvedDebugConfiguration({
				program: "${workspaceFolder}/bin/main.dart",
			});
			assert.equal(resolvedProgram, null);
			assert.ok(showErrorMessage.calledWith("Launch config property 'program' has unresolvable variable ${workspaceFolder}"));

			showErrorMessage.resetHistory();
			const resolvedCwd = await getResolvedDebugConfiguration({
				cwd: "${workspaceFolder}",
				program: fsPath(helloWorldMainFile),
			});
			assert.equal(resolvedCwd, null);
			assert.ok(showErrorMessage.calledWith("Launch config property 'cwd' has unresolvable variable ${workspaceFolder}"));
		});

		it("shows information message and returns null when no program can be determined", async () => {
			const emptyFolder = getRandomTempFolder();
			defer("delete temp folder", () => tryDelete(emptyFolder));
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			const resolvedConfig = await getResolvedDebugConfiguration({
				cwd: emptyFolder,
				program: undefined,
			});

			assert.equal(resolvedConfig, null);
			assert.ok(showInformationMessage.calledOnceWithExactly("Set the 'program' value in your launch config (eg 'bin/main.dart') then launch again"));
		});

		it("falls back to example folder in guessBestEntryPoint when package has no bin, lib/main.dart, or web", async () => {
			const pkgFolder = createTempPubPackage("my_pkg");
			const exampleMain = path.join(pkgFolder, "example", "bin", "main.dart");
			createTempTestFile(exampleMain, "void main() {}\n");

			const resolvedConfig = await getResolvedDebugConfiguration({
				cwd: pkgFolder,
				program: undefined,
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, exampleMain);
		});

		it("warns when program references a non-existent file", async () => {
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(undefined);
			const missingProgram = path.join(fsPath(helloWorldFolder), "bin", "does_not_exist.dart");

			const resolvedConfig = await getResolvedDebugConfiguration({
				program: missingProgram,
			});

			assert.ok(resolvedConfig);
			assert.ok(showWarningMessage.calledOnceWithExactly(`Your launch config references a program that does not exist. If you have problems launching, check the "program" field in your ".vscode/launch.json" file.`));
		});

		it("shows error and aborts when launching a Flutter project in a Dart-only workspace", async () => {
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(flutterHelloWorldMainFile),
			});

			assert.equal(resolvedConfig, undefined);
			assert.ok(showErrorMessage.calledOnceWithExactly(`Unable to launch Flutter project in a Dart-only workspace. Please open a folder closer to your Flutter project root or increase the value of the "dart.projectSearchDepth" setting.`));
		});

		it("shows error and aborts when launching tests in a web project", async () => {
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);
			const webFolder = path.join(fsPath(helloWorldFolder), "web");
			const webTestFile = path.join(webFolder, "test", "web_test.dart");
			defer("delete temp web folder", () => tryDelete(webFolder));
			createTempTestFile(webTestFile, "void main() {}\n");

			const resolvedConfig = await getResolvedDebugConfiguration({
				program: webTestFile,
			});

			assert.equal(resolvedConfig, undefined);
			assert.ok(showErrorMessage.calledOnceWithExactly("Tests in web projects are not currently supported"));
		});

		it("installs webdev dependencies for web launches and aborts if installation fails", async () => {
			const webFolder = path.join(fsPath(helloWorldFolder), "web");
			const webMainFile = path.join(webFolder, "main.dart");
			defer("delete temp web folder", () => tryDelete(webFolder));
			createTempTestFile(webMainFile, "void main() {}\n");
			const installIfRequired = sb.stub(privateApi.pubGlobal, "installIfRequired");

			// Aborts when webdev installation returns undefined.
			installIfRequired.resolves(undefined);
			const abortedConfig = await getResolvedDebugConfiguration({
				program: webMainFile,
			});
			assert.equal(abortedConfig, undefined);

			// Proceeds with Web debugger when webdev is installed.
			installIfRequired.resolves("2.0.0");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: webMainFile,
			});
			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.debuggerType, DebuggerType.Web);
		});

		it("prompts for VM service URI when attaching without one and aborts if cancelled", async () => {
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const promptForVmService = executeCommand.withArgs("dart.promptForVmService").resolves(undefined);
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			// Aborts when user cancels the VM service URI prompt.
			const cancelledConfig = await getAttachConfiguration();
			assert.equal(cancelledConfig, undefined);
			assert.ok(promptForVmService.calledOnce);
			assert.ok(showInformationMessage.calledOnceWithExactly("You must provide a VM service URI/port to attach a debugger"));

			// Converts a bare port number into a localhost HTTP URI.
			promptForVmService.resolves("8181");
			const resolvedConfig = await getAttachConfiguration();
			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.vmServiceUri, "http://127.0.0.1:8181");
		});

		it("respects explicitly set debuggerType", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				debuggerType: "dart",
				program: fsPath(helloWorldMainFile),
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.debuggerType, DebuggerType.Dart);
		});

		it("prompts when project has Dart errors and respects user choice", async () => {
			const diagnostic = new vs.Diagnostic(new vs.Range(0, 0, 0, 5), "Some Dart error", vs.DiagnosticSeverity.Error);
			diagnostic.source = "dart";
			sb.stub(vs.languages, "getDiagnostics").returns([[helloWorldMainFile, [diagnostic]]]);
			const executeCommand = sb.stub(vs.commands, "executeCommand").callThrough();
			const showErrorsCmd = executeCommand.withArgs("workbench.action.showErrorsWarnings").resolves(undefined);
			const showErrorMessage = sb.stub(vs.window, "showErrorMessage");

			// Selecting "Show Errors" opens the problems view and aborts the launch.
			showErrorMessage.resolves(showErrorsAction as any);
			const abortedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
			});
			assert.equal(abortedConfig, undefined);
			assert.ok(showErrorsCmd.calledOnce);

			// Selecting "Debug Anyway" continues with the launch.
			showErrorMessage.resolves(runAnywayAction as any);
			const continuedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldMainFile),
			});
			assert.ok(continuedConfig);
		});
	});
});

describe("dart test debugger", () => {
	before("activate", () => activate(null));

	describe("resolves the correct debug config", () => {
		it("passing launch.json's toolArgs to the VM", async () => {
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
				toolArgs: ["--fake-flag"],
			});

			assert.ok(resolvedConfig);
			assert.equal(resolvedConfig.program, fsPath(helloWorldTestMainFile));
			assert.equal(resolvedConfig.cwd, fsPath(helloWorldFolder));
			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--fake-flag"]);
		});

		it("when testAdditionalArgs is set", async () => {
			await setConfigForTest("dart", "testAdditionalArgs", ["--my-test-flag"]);
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
			});

			ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--my-test-flag"]);
		});

		it("when suppressTestTimeouts is set", async () => {
			await setConfigForTest("dart", "suppressTestTimeouts", "always");
			const resolvedConfig = await getResolvedDebugConfiguration({
				program: fsPath(helloWorldTestMainFile),
			});

			const testCapabilities = getPackageTestCapabilitiesForDartProject(privateApi.logger, privateApi.workspaceContext, resolvedConfig.cwd!);
			if (testCapabilities.supportsIgnoreTimeouts)
				ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--ignore-timeouts"]);
			else
				ensureArrayContainsArray(resolvedConfig.toolArgs!, ["--timeout"]);
		});
	});
});

describe("InitialLaunchJsonDebugConfigProvider (Dart)", () => {
	before("activate", () => activate(null));

	it("returns launch configs for Dart projects including nested projects", async () => {
		const configs = await privateApi.initialDebugProvider.provideDebugConfigurations!(vs.workspace.workspaceFolders![0]);

		assert.deepStrictEqual(configs, [
			{
				cwd: undefined,
				name: "hello_world",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				name: "example",
				request: "launch",
				type: "dart",
			},
		]);
	});

	it("falls back to default Dart & Flutter config when folder is undefined or has no projects", async () => {
		const undefinedFolderConfigs = await privateApi.initialDebugProvider.provideDebugConfigurations!(undefined);
		assert.deepStrictEqual(undefinedFolderConfigs, [
			{
				name: "Dart & Flutter",
				request: "launch",
				type: "dart",
			},
		]);

		const emptyFolder = getRandomTempFolder();
		defer("delete temp folder", () => tryDelete(emptyFolder));
		const emptyFolderConfigs = await privateApi.initialDebugProvider.provideDebugConfigurations!({
			index: 0,
			name: "empty",
			uri: vs.Uri.file(emptyFolder),
		});
		assert.deepStrictEqual(emptyFolderConfigs, [
			{
				name: "Dart & Flutter",
				request: "launch",
				type: "dart",
			},
		]);
	});
});

describe("DynamicDebugConfigProvider (Dart)", () => {
	before("activate", () => activate(null));

	it("returns dynamic launch configs for Dart CLI, test, and web projects", async () => {
		// Standard Dart CLI project with nested example project and tests.
		const cliConfigs = await privateApi.dynamicDebugProvider.provideDebugConfigurations!(vs.workspace.workspaceFolders![0]);
		assert.deepStrictEqual(cliConfigs, [
			{
				cwd: undefined,
				name: "hello_world (Dart)",
				program: "bin/main.dart",
				request: "launch",
				type: "dart",
			},
			{
				cwd: undefined,
				name: "hello_world (Dart Tests)",
				program: "test",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				name: "example (Dart)",
				program: "bin/main.dart",
				request: "launch",
				type: "dart",
			},
			{
				cwd: "example",
				name: "example (Dart Tests)",
				program: "test",
				request: "launch",
				type: "dart",
			},
		]);

		// Dart web project with a web/ folder.
		const webConfigs = await privateApi.dynamicDebugProvider.provideDebugConfigurations!({
			index: 0,
			name: "hello_world",
			uri: webHelloWorldFolder,
		});
		assert.deepStrictEqual(webConfigs, [
			{
				cwd: undefined,
				name: "hello_world (Dart Web)",
				program: "web",
				request: "launch",
				type: "dart",
			},
		]);

		// Undefined workspace folder returns no dynamic configurations.
		const emptyConfigs = await privateApi.dynamicDebugProvider.provideDebugConfigurations!(undefined);
		assert.deepStrictEqual(emptyConfigs, []);
	});
});
