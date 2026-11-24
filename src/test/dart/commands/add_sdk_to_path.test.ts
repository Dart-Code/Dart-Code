import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { addSdkToPathAction, addSdkToPathPrompt, addedToPathPrompt, addToPathInstructionsUrl, copySdkBinPathToClipboardAction, isMac, isWin, noSdkAvailablePrompt, noThanksAction, openInstructionsAction, sdkAlreadyOnPathPrompt, unableToAddToPathPrompt } from "../../../shared/constants";
import { activate, defer, fixPath, getRandomTempFolder, privateApi, sb, tryDelete } from "../../helpers";
import { ChildProcessSpawnStub } from "../../mocks/child_process_spawn_stub";

describe("AddSdkToPath", () => {
	before("activate", () => activate());

	const fakeDartSdk = fixPath("/fake/dart-sdk");
	const fakeFlutterSdk = fixPath("/fake/flutter-sdk");

	function setEnvVar(name: string, value: string | undefined): void {
		const original = process.env[name];
		if (value === undefined)
			delete process.env[name];
		else
			process.env[name] = value;

		defer(`restore ${name}`, () => {
			if (original === undefined)
				delete process.env[name];
			else
				process.env[name] = original;
		});
	}

	function useTempHome(): string {
		const home = getRandomTempFolder();
		setEnvVar("HOME", home);
		defer("remove temp home", () => tryDelete(home));
		return home;
	}

	function unixProfilePath(home: string, shell: string): string {
		if (shell === "zsh")
			return path.join(home, ".zshenv");
		return path.join(home, isMac ? ".bash_profile" : ".bashrc");
	}

	function prepareAddToPath(outcome: "succeeded" | "alreadyExisted" | "failed" = "succeeded", existingSdkPath = fakeDartSdk) {
		if (isWin) {
			const result = outcome === "alreadyExisted"
				? { exitCode: 12345 }
				: outcome === "failed"
					? { exitCode: 1, stderr: "failure" }
					: { exitCode: 0 };
			const spawn = ChildProcessSpawnStub.powershellAddToPath(result);
			return {
				assertAdded: (sdkRoot: string) => {
					spawn.assertCalls([{
						args: [
							"-NoProfile",
							"-NonInteractive",
							"-WindowStyle", "Hidden",
							"-ExecutionPolicy", "Bypass",
							"-File", privateApi.context.asAbsolutePath("media/add_to_path.ps1"),
							path.join(sdkRoot, "bin"),
						],
						bin: "powershell",
						cwd: undefined,
					}]);
				},
				assertNotRun: () => spawn.assertCalls([]),
			};
		}

		setEnvVar("SHELL", "/bin/bash");
		const home = useTempHome();
		const profile = unixProfilePath(home, "bash");
		if (outcome === "alreadyExisted")
			fs.writeFileSync(profile, `export PATH="${path.join(existingSdkPath, "bin")}:$PATH"\n`);
		else if (outcome === "failed")
			// Make the profile path a directory so appending fails.
			fs.mkdirSync(profile);

		return {
			assertAdded: (sdkRoot: string) => {
				assert.equal(fs.readFileSync(profile, "utf8"), `export PATH="${path.join(sdkRoot, "bin")}:$PATH"\n`);
			},
			assertNotRun: () => assert.equal(fs.existsSync(profile), false),
		};
	}

	it("shows an error when no SDK path is provided", async () => {
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		await privateApi.addSdkToPathCommands.addToPath("Dart", undefined);

		assert.ok(showErrorMessage.calledOnceWithExactly(noSdkAvailablePrompt));
	});

	it("adds the SDK bin folder to PATH", async () => {
		const env = prepareAddToPath("succeeded");
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

		env.assertAdded(fakeDartSdk);
		assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Dart")));
	});

	it("reports when the SDK is already on PATH", async () => {
		const env = prepareAddToPath("alreadyExisted", fakeDartSdk);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

		env.assertAdded(fakeDartSdk);
		assert.ok(showInformationMessage.calledOnceWithExactly(sdkAlreadyOnPathPrompt("Dart")));
	});

	it("uses the warning prompt for manual instructions after an automatic failure", async function () {
		if (!addToPathInstructionsUrl)
			return this.skip();
		prepareAddToPath("failed");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(noThanksAction);

		await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

		assert.ok(showWarningMessage.calledOnceWithExactly(unableToAddToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction));
	});

	it("opens the instructions URL from the manual instructions prompt", async function () {
		if (!addToPathInstructionsUrl)
			return this.skip();
		prepareAddToPath("failed");
		const openInBrowser = sb.stub(privateApi.envUtils, "openInBrowser").resolves(true);
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		showWarningMessage.onFirstCall().resolves(openInstructionsAction);
		showWarningMessage.onSecondCall().resolves(noThanksAction);

		await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

		assert.equal(showWarningMessage.callCount, 2);
		assert.ok(openInBrowser.calledOnceWithExactly(addToPathInstructionsUrl));
	});

	it("copies the SDK bin path to the clipboard from the manual instructions prompt", async function () {
		if (!addToPathInstructionsUrl)
			return this.skip();
		prepareAddToPath("failed");
		await vs.env.clipboard.writeText("");
		const showWarningMessage = sb.stub(vs.window, "showWarningMessage");
		showWarningMessage.onFirstCall().resolves(copySdkBinPathToClipboardAction);
		showWarningMessage.onSecondCall().resolves(noThanksAction);

		await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

		assert.equal(showWarningMessage.callCount, 2);
		// vs.env.clipboard cannot be stubbed, so verify the real clipboard like
		// the debug command tests do.
		assert.equal(await vs.env.clipboard.readText(), path.join(fakeDartSdk, "bin"));
	});

	it("reports already-on-PATH when the update fails but PATH contains the SDK", async () => {
		prepareAddToPath("failed");
		const originalPath = process.env.PATH;
		setEnvVar("PATH", `${originalPath ?? ""}${path.delimiter}${path.join(fakeDartSdk, "bin")}`);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

		assert.ok(showInformationMessage.calledOnceWithExactly(sdkAlreadyOnPathPrompt("Dart")));
	});

	it("promptToAddToPath asks and adds to PATH when accepted", async () => {
		const env = prepareAddToPath("succeeded");
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(addSdkToPathAction);

		await privateApi.addSdkToPathCommands.promptToAddToPath("Dart", fakeDartSdk);

		// addToPath shows a second prompt with the result, so check each call.
		assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), addSdkToPathAction, noThanksAction]);
		assert.deepEqual(showInformationMessage.secondCall.args, [addedToPathPrompt("Dart")]);
		env.assertAdded(fakeDartSdk);
	});

	it("promptToAddToPath does nothing when declined", async () => {
		const env = prepareAddToPath("succeeded");
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(noThanksAction);

		await privateApi.addSdkToPathCommands.promptToAddToPath("Dart", fakeDartSdk);

		assert.ok(showInformationMessage.calledOnce);
		env.assertNotRun();
	});

	it("flutter.addSdkToPath adds the workspace Flutter SDK to PATH", async () => {
		const env = prepareAddToPath("succeeded");
		sb.stub(privateApi.workspaceContext.sdks, "flutter").value(fakeFlutterSdk);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await vs.commands.executeCommand("flutter.addSdkToPath");

		env.assertAdded(fakeFlutterSdk);
		assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Flutter")));
	});

	it("flutter.addSdkToPath shows an error when no Flutter SDK is available", async () => {
		sb.stub(privateApi.workspaceContext.sdks, "flutter").value(undefined);
		const showErrorMessage = sb.stub(vs.window, "showErrorMessage").resolves(undefined);

		await vs.commands.executeCommand("flutter.addSdkToPath");

		assert.ok(showErrorMessage.calledOnceWithExactly(noSdkAvailablePrompt));
	});

	it("dart.addSdkToPath delegates to flutter.addSdkToPath when the Dart SDK comes from Flutter", async () => {
		const env = prepareAddToPath("succeeded");
		sb.stub(privateApi.workspaceContext.sdks, "dart").value(fakeDartSdk);
		sb.stub(privateApi.workspaceContext.sdks, "flutter").value(fakeFlutterSdk);
		sb.stub(privateApi.workspaceContext.sdks, "dartSdkIsFromFlutter").value(true);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await vs.commands.executeCommand("dart.addSdkToPath");

		env.assertAdded(fakeFlutterSdk);
		assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Flutter")));
	});

	it("dart.addSdkToPath uses the Dart SDK directly when it is not from Flutter", async () => {
		const env = prepareAddToPath("succeeded");
		sb.stub(privateApi.workspaceContext.sdks, "dart").value(fakeDartSdk);
		sb.stub(privateApi.workspaceContext.sdks, "flutter").value(fakeFlutterSdk);
		sb.stub(privateApi.workspaceContext.sdks, "dartSdkIsFromFlutter").value(false);
		const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

		await vs.commands.executeCommand("dart.addSdkToPath");

		env.assertAdded(fakeDartSdk);
		assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Dart")));
	});

	describe("Unix", () => {
		beforeEach(function () {
			if (isWin)
				this.skip();
		});

		it("appends the export line to .zshenv for zsh", async () => {
			setEnvVar("SHELL", "/usr/bin/zsh");
			const home = useTempHome();
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			await privateApi.addSdkToPathCommands.addToPath("Flutter", fakeFlutterSdk);

			const profile = unixProfilePath(home, "zsh");
			assert.equal(fs.readFileSync(profile, "utf8"), `export PATH="${path.join(fakeFlutterSdk, "bin")}:$PATH"\n`);
			assert.ok(showInformationMessage.calledOnceWithExactly(addedToPathPrompt("Flutter")));
		});

		it("separates the export line from existing content without a trailing newline", async () => {
			setEnvVar("SHELL", "/bin/bash");
			const home = useTempHome();
			const profile = unixProfilePath(home, "bash");
			fs.writeFileSync(profile, "existing content");
			sb.stub(vs.window, "showInformationMessage").resolves(undefined);

			await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);
			await privateApi.addSdkToPathCommands.addToPath("Flutter", fakeFlutterSdk);

			assert.equal(
				fs.readFileSync(profile, "utf8"),
				`existing content\nexport PATH="${path.join(fakeDartSdk, "bin")}:$PATH"\nexport PATH="${path.join(fakeFlutterSdk, "bin")}:$PATH"\n`,
			);
		});

		it("shows manual instructions when the shell is unsupported", async function () {
			if (!addToPathInstructionsUrl)
				return this.skip();
			setEnvVar("SHELL", "/bin/fish");
			const home = useTempHome();
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage").resolves(noThanksAction);

			await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

			assert.ok(showInformationMessage.calledOnceWithExactly(addSdkToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction));
			assert.deepEqual(fs.readdirSync(home), []);
		});

		it("promptToAddToPath shows manual instructions and copies SDK bin path when automatic add is unavailable", async function () {
			if (!addToPathInstructionsUrl)
				return this.skip();
			setEnvVar("SHELL", undefined);
			useTempHome();
			await vs.env.clipboard.writeText("");
			const showInformationMessage = sb.stub(vs.window, "showInformationMessage");
			showInformationMessage.onFirstCall().resolves(copySdkBinPathToClipboardAction);
			showInformationMessage.onSecondCall().resolves(noThanksAction);

			await privateApi.addSdkToPathCommands.promptToAddToPath("Dart", fakeDartSdk);

			assert.equal(showInformationMessage.callCount, 2);
			assert.deepEqual(showInformationMessage.firstCall.args, [addSdkToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction]);
			assert.equal(await vs.env.clipboard.readText(), path.join(fakeDartSdk, "bin"));
		});
	});

	describe("Windows", () => {
		beforeEach(function () {
			if (!isWin)
				this.skip();
		});

		it("shows manual instructions when PowerShell cannot be spawned", async function () {
			if (!addToPathInstructionsUrl)
				return this.skip();
			ChildProcessSpawnStub.powershellAddToPath({ error: new Error("spawn powershell ENOENT") });
			const showWarningMessage = sb.stub(vs.window, "showWarningMessage").resolves(noThanksAction);

			await privateApi.addSdkToPathCommands.addToPath("Dart", fakeDartSdk);

			assert.ok(showWarningMessage.calledOnceWithExactly(unableToAddToPathPrompt("Dart"), openInstructionsAction, copySdkBinPathToClipboardAction, noThanksAction));
		});
	});
});
