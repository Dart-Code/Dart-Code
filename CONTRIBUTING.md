[![Discord Chat](https://img.shields.io/badge/chat-discord-blue.svg)](https://discord.gg/xSTPEqm)
[![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode)
[![Follow on Bluesky](https://img.shields.io/badge/bluesky-dartcode.org-blue.svg)](https://bsky.app/profile/dartcode.org)

# Raising Issues in Dart Code

If you've found an issue or have a suggestion for Dart Code, please do [open an issue](https://github.com/Dart-Code/Dart-Code/issues/new). For bugs, it is beneficial to attach a log file recorded while reproducing the issue. Information on using the `Capture Logs` command or enabling background logging is available [on the Dart Code website](https://dartcode.org/docs/logging/).

# Contributing Code to Dart Code

If you're going to work on an issue, please add a comment to the issue so others know it's being looked at. If there isn't an issue for the work you want to do, please create one. The [good first issue](https://github.com/Dart-Code/Dart-Code/labels/good%20first%20issue%20%3Aoctocat%3A) issues might make good starting points for new contributors.

For general details on developing VS Code extensions see the [VS Code API docs](https://code.visualstudio.com/api).

## LSP and DAP

At the time of writing, the Dart/Flutter extensions are migrating from using VS Code APIs directly for language integration to a [Language Server Protocol](https://microsoft.github.io/language-server-protocol/) implementation [in the Dart analysis server](https://github.com/dart-lang/sdk/blob/main/pkg/analysis_server/tool/lsp_spec/README.md) and also from a Dart Code shipped [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) implementation to one shipped in the [Dart](https://github.com/dart-lang/sdk/blob/master/pkg/dds/tool/dap/README.md)/[Flutter](https://github.com/flutter/flutter/blob/master/packages/flutter_tools/lib/src/debug_adapters/README.md) SDKs.

This means there may be two implementations (one here, one in the SDK) of some functionality. The Dart Code implementations remain available for older SDKs but generally new work should be done in just the SDK LSP/DAP servers (except where the protocols do not support the required functionality).

## Project Structure

Dart Code is currently written in TypeScript. There's a lot of configuration for how Code interacts with Dart Code in `package.json` though the main entry point is the `activate` method in `src/extension/extension.ts`. Functionality is split into classes that provide small pieces of functionality via the Code APIs ([which are documented here](https://code.visualstudio.com/docs/extensionAPI/vscode-api)).

Source code is split into several top level folders:

### src/extension

The folder contains VS Code extension-specific code - for example VS Code providers and the extension activation/deactivation code. This code should not be imported directly into any files outside of this folder.

The `src/extension/analysis` folder contains classes for interacting with the Dart analysis server (either via its own protocol or LSP) over `stdin`/`stdout` which is used for most of the langauge support in Dart Code. Some of these files were originally auto-generated from the [analysis server specification](https://htmlpreview.github.io/?https://github.com/dart-lang/sdk/blob/master/pkg/analysis_server/doc/api.html) although are now generally hand-maintained.

The `src/extension/commands` folder contains commands that Dart Code handles that are not tied to API providers, such as the command executed when a debug session starts and commands added to the command palette like **Dart: Get Packages**.

The `src/extension/providers` folder contains the implementation for all of the providers wired up in `src/extension/extension.ts` during activation. These provide functionality like code completion, formatting, reporting errors, etc when using the original Dart analysis server protocol. When using LSP (which is the case for almost all users on modern SDKs) these providers are not used, and the client/server negotiate which features are available as part of the LSP initialization.

The `src/extension/services` folder contains some plumbing code for services, such as a base class for various services Dart Code uses that communicate over `stdin`/`stdout` streams.

### src/debug

This folder contains the original Debug adapter code that implements the [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) which is being superseded by the Dart/Flutter SDK implementations. This code (or the SDK equiv) is in charge of launching Dart and Flutter apps and forwarding the DAP requests on to the VM via the [Dart VM Service protocol](https://github.com/dart-lang/sdk/blob/master/runtime/vm/service/service.md).

Debug adapters run out-of-process from the main extension code. Code in this folder should therefore not call any VS Code APIs directly (only DAP APIs). `CustomEvent`s can be used to communicate with the main VS Code extension host process.

Code in this folder must not be imported into any files outside of this folder. Code in this folder may import code from `src/shared` as long as it's not inside a folder named `vscode`.

### src/shared

This folder contains all shared code that can be used by `extension`, `debug` and `test` code. This code should not contain any global state, nor should it define classes that may be tested with `instanceof`. This is because the extension code is packed with webpack and any state/classes will be duplicated in both packed and unpacked code (leading to multiple copies and unexpected behaviour during test runs). Any code in here that uses the `vscode` module should be inside a folder named `vscode` to allow the lints to detect it being imported into debug adapters (`src/debug`).

### src/test

Code for automated tests, including some test projects (in `src/test/test_projects`) required by the tests. Code here should not be imported into any files outside of this folder. Small classes are tested with unit tests, but classes that interact directly with VS Code are usually tested with integration tests which can run with both Dart Code+SDK implementations of the DAP (via different launch configurations).

### src/tool

Util scripts for helping with project maintenance. For example, a script to generate the `launch.json` file because it contains a lot of boilerplate for a large number of launch configurations.


## Cloning and Running Dart Code

Running Dart Code from source is relatively straight forward. You should:

1. Clone the Dart Code repository (or your own fork)
2. Run `npm install` to install dependencies
3. Run `git submodule init` and `git submodule update` to fetch submodules that contain Flutter images
4. Open the repository root folder in Visual Studio Code
5. Run the **Dart: Get Packages** command to fetch packages for the nested integration test projects
6. Ensure "Extension" is selected in the Debug side bar
7. Press `F5`

This will compile Dart Code and launch the Code **Extension Development Host** - an instance of VS Code running the locally compiled extension. In the original VS Code instance you should be able to add breakpoints in the Dart Code source code and hit them by using Dart Code in the extension development host. If you make code changes you'll want to click the `Restart` button in the standard instance (or press `Ctrl+Shift+F5`) in order to reload changes.

## Automated Tests

Automated tests live in the `src/test` folder and each sub-folder has a launch configuration you can select form the Debug side bar to run them (for example the `test/dart` folder can be run with the **Dart Tests** debug configuration ). You can also use `npm test` to run the whole suite in one go (without the debugging). Running the test suite may spawn Code windows multiple times during execution as multiple workspaces are tested.

To run an individual test, add `.only()` to the end of the `describe()` or `it()` calls (such as `describe.only()` or `it.only()`).

All tests will be run on all supported platforms via GitHub Actions periodically, and for a subset of platforms on the `master` branch and PRs.

## Debugging the Debug Adapters

Debug adapters run out-of-process so are not directly debuggable with the extension. There are generated launch configurations that will run them in server-mode and attach the debugger so that they can be debugged simultaneously with the extension code (this also applies to running automated tests), although this only applies to the original Dart Code implementations of the DAP. The new SDK DAPs cannot currently be debugged this way (and should be developed/debugged in the SDK repo using its own tests).

## Code Etiquette and Style

- If your branch lives for a long time, rebase on top of `master` before sending pull requests to ensure any conflicts are dealt with
- Try to keep the bulk of work out of `extension.ts` by creating new files/classes but do keep the wire-up code in `extension.ts` as a central place to track what's set up
- Code Style (these are mostly enforced with lints)
  - Use PascalCase for type names and enum values
  - Use camelCase for function names
  - Use camelCase for property names and local variables
  - Do not use `_` as a prefix for private properties
  - Use whole words in names when possible
  - Prefer double quotes `"` over single quotes `'` as they're easier to distinguise from backticks `` ` `` (which TS uses for Template Strings)
  - Prefer positively-named booleans/settings (`showTodos`) and set defaults accordingly rather than negatively-named (`disableLogging`) to avoid double-negatives (`if (!disableLogging) { log(); }`).
  - Indent with tabs
  - Reformat files (`Alt+Shift+F`) before committing (or use `editor.formatOnSave`/`editor.formatOnType`)
  - Prefer arrow functions over anonymous function expressions
  - Only surround arrow function parameters with parens when necessary


## Issue Triage

If an issue doesn't have enough information to investigate, the required information should be noted on the issue and the **awaiting info** label applied. Issues with this tag will automatically be commented on and closed by a bot after some period with no updates.

Issues blocked by an upstream change (for example Dart, Flutter or VS Code) should be labelled with **blocked on xxx**.

Issues that have been fixed by changes upstream (for example Dart, Flutter or VS Code) should be labelled with **fixed in xxx**.

The green **in xxx** labels should be used to categorise the area the issue exists in. Read the label descriptions for specifics.

The blue **is xxx** labels should describe the type of issue (bug, enhancement, performance, automated testing).

If an issue appears to be specific to a platform, the appropriate lime **on xxx** platform label should be added.

## Release Procedure

### Testing

- Before testing/deploying, ensure you have run `npm install` recently so that your local dependencies match those listed in the dependencies list (in case they have been upgraded)
- Ensure all local changes are committed and your local folder is free of artifacts/log files/etc.
- Ensure all automated tests pass
- Ensure extension behaves correctly for a Dart project
  - Activates correctly (SDK version appears in status bar)
  - No errors in dev console (Help -> Toggle Developer Tools)
  - Code completion, go-to-definition and other basic functionality work
  - Able to launch a simple Dart script inside a `bin/` folder
    - Add a breakpoint to user code
	- Press `F5` to begin debugging and ensure breakpoint is hit
- Ensure extension behaves correctly for a Flutter project
  - Activates correctly (SDK version appears in status bar, tooltip shows "(Flutter)")
  - No errors in dev console (Help -> Toggle Developer Tools)
  - Code completion, go-to-definition and other basic functionality work
  - Able to launch a simple Flutter app
    - Add a breakpoint to user code
	- Press `F5` to begin debugging and ensure breakpoint is hit
    - Hot reload and ensure breakpoint hit again


### Deploying

- Set the version number correctly in `packages.json`
- Commit and push to GitHub (pushing before creating the GH release is important for the tag to be against the correct version)
- **Run `vsce package` to build the extension**
- Create a new Release on GitHub with the title "Dart Code v{x.y.z}" where `{x.y.z}` is the correct version number and copy the body text from a previous release, amending the version number/release notes link and attaching the build vsix
- Use the `tool/generate_release_notes.dart` script in the [Website](https://github.com/Dart-Code/Website) repo to generate placeholder release notes from the latest GitHub milestone
- Review/reword release notes, adding screenshots for any significant features
- If the version is not final, set `provisional: true` in the website release notes YAML front matter
- Commit and push to GitHub

To release Dart Code you will need access to the Publisher account on the VS marketplace and will need to install [`vsce`](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#vsce). Follow [these instructions](https://code.visualstudio.com/docs/extensions/publish-extension) to get vsce set up and authorised with a personal access token.

- **Run `vsce publish` to publish the extension**
- Open your stable version of Code (which should have Dart Code installed) and ensure it shows the update/auto-updates
  - This may take a few minutes due to VS Code marketplace caching
- Do some basic testing of the published release
  - If significant issues are found, they either need fixing or a new version of the extension to be re-published from the previous releases tag
- Announce the new release in [Discord](https://discord.gg/xSTPEqm)/Twitter/etc.!
- Increase the version number in `packages.json` and add a `-dev` suffix back for the next version and commit/push

Note: Until the VS Code marketplace properly supports pre-release version numbers, we use a convention of even minor numbers for stable releases and odd minor numbers for pre-release (and use the date in format YYYMMDD for the patch version). For example:

- 3.10.0 - stable release
- 3.10.1 - stable bug-fix release
- 3.11.20220109 - pre-release version on 9th Jan 2022
- 3.12.0 - stable release

Pre-release versions **must** be published using the `vsce publish --pre-release`, so that they only show up for users that have opted in to pre-release versions.


#### Deploying the Flutter extension

The Flutter extension should be updated with every Dart extension release and the version numbers kept in-sync. Currently the Flutter extension has very little code and therefore the release process is very simple.

- Increase the version number in `package.json`
- Commit and push to GitHub
- Create a new Release on GitHub with the version number and copy the body text from a previous release, amending the version number/release notes link
- **Run `vsce publish` to publish the extension**
