[![Discord Chat](https://img.shields.io/badge/chat-discord-blue.svg)](https://discord.gg/xSTPEqm)
[![Gitter Chat](https://img.shields.io/badge/chat-gitter-blue.svg)](https://gitter.im/dart-code/Dart-Code)
[![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode)

# Raising Issues in Dart Code

If you've found an issue or have a suggestion for Dart Code, please do [open an issue](https://github.com/Dart-Code/Dart-Code/issues/new). For bugs, it is beneficial to attach a log file recorded while reproducing the issue. Information on using the `Capture Logs` command or enabling background logging is available [on the Dart Code website](https://dartcode.org/docs/logging/).

# Contributing Code to Dart Code

If you're going to work on an issue, please add a comment to the issue so others know it's being looked at. If there isn't an issue for the work you want to do, please create one. The [good first issue](https://github.com/Dart-Code/Dart-Code/labels/good%20first%20issue) issues might make good starting points for new contributors.

## Project Structure

Dart Code is currently written in TypeScript. There's a lot of configuration for how Code interacts with Dart Code in `package.json` though the main entry point is the `activate` method in `src/extension/extension.ts`. Functionality is split into classes that provide small pieces of functionality via the Code APIs ([which are documented here](https://code.visualstudio.com/docs/extensionAPI/vscode-api)).

The `src/extension/analysis` folder contains classes relating to the Dart analysis server (shipped inside the SDK) that is used for most of the langauge services in Dart Code. Some of these files are auto-generated from the [analysis server specification](https://htmlpreview.github.io/?https://github.com/dart-lang/sdk/blob/master/pkg/analysis_server/doc/api.html).

The `src/extension/commands` folder contains commands that Dart Code handles that are not tied to API providers, such as the command executed when a debug session starts and commands added to the command palette like `pub get`.

The `src/extension/debug` folder contains debug adapters used for communicating between Code and the Dart debugger. The Code side of this is [documented here](https://code.visualstudio.com/docs/extensionAPI/api-debugging) and the Dart/Obseravtory side is [documented here](https://github.com/dart-lang/sdk/blob/master/runtime/vm/service/service.md).

The `src/extension/providers` folder contains the implementation for all of the providers wired up in `src/extension/extension.ts` during activation. These provide functionality like code completion, formatting, reporting errors, etc. Most of these interact with the analysis server from the `src/extension/analysis` folder.

The `src/extension/services` folder contains some plumbing code for services, such as a base class for various services Dart Code uses that communicate over `STDIN`/`STDOUT` streams.

## Cloning and Running Dart Code

Running Dart Code from source is relatively straight forward. You should:

1. Clone the Dart Code repository (or your own fork)
2. Run `npm install` to install dependencies
3. Open the repository root folder in Visual Studio Code
4. Press F5

This will compile Dart Code and launch the Code `"Extension Development Host"`. You may see a warning in the top of the screen telling you the extension has been overwritten - this is normal; it's Code informing you that the normal installed version of the extension has been replaced by the version you just compiled. This only affects that particular session of the extension development host.

You'll now have two versions of Code open - the standard instance that has the Dart Code source code open and the extension development host which is running the extension. In the standard instance you should be able to add breakpoints in the Dart Code source code and hit them by using Dart Code in the extension development host. If you make code changes you'll want to click the `Restart` button in the standard instance (or press `Ctrl+Shift+F5`) in order to reload changes.

## Automated Tests

Automated tests live in the `test` folder and have launch configurations you can select form the debug menu to run them. You can also use `npm test` to run the whole suite in one go (without the debugging). Running the test suite may spawn Code windows multiple times during execution as multiple workspaces are tested in stable and insiders versions of Code.

Each test suite consists of a folder of tests (for ex. `general` and `flutter`) and a workspace folder that is loaded at the start of the test runs (at the time of writing there's a `hello_world` and a `flutter_hello_world` app). Config for these lives in two places - the `test_all.ts` script and also the `launch.json` file (one is used for command line running and the other for launching in a way that the debugger can be attached).

All tests will be run on all platforms when you submit a PR and the status shown alongside the PR.

## Debugging the Debug Adapters

Debug adapters now run in-process and debugging them should be the same as any other extension code.

## Code Etiquette and Style

- If you end up with a large number of commits for tidying up/fixing, consider squashing
- If your branch lives for a long time, rebase on top of `master` before sending pull requests to ensure any conflicts are dealt with
- Try to keep the bulk of work out of `extension.ts` by creating new files/classes but do keep the wire-up code in `extension.ts` as a central place to track what's set up
- Code Style
  - Use PascalCase for type names
  - Do not use `I` as a prefix for interface names
  - Use PascalCase for enum values
  - Use camelCase for function names
  - Use camelCase for property names and local variables
  - Do not use `_` as a prefix for private properties
  - Use whole words in names when possible
  - Prefer double quotes `"` over single quotes `'` as they're easier to distinguise from backticks `` ` `` (which TS uses for Template Strings)
  - Prefer positively-named booleans/settings (`showTodos`) and set defaults accordingly rather than negatively-named (`disableLogging`) to avoid double-negatives (`if (!disableLogging) { log(); }`).
  - Indent with tabs
  - Reformat files (`Alt+Shift+F`) before committing (or enabled `editor.formatOnSave`)
  - Use arrow functions over anonymous function expressions
  - Only surround arrow function parameters with parens when necessary

## Release Procedure

### Testing

- Before testing/deploying, ensure you have run `npm install` recently so that your local dependencies match those listed in the dependencies list (in case they have been upgraded)
- Ensure all local changes are committed and your local folder is free of artifacts/log files/etc.
- Ensure all automated tests pass
- Ensure extension behaves correctly for a Dart project
  - Activates correctly (SDK version appears in status bar)
  - No errors in dev console (Help -> Toggle Developer Tools)
  - Code completion, go-to-definition and other basic functionality work
  - Able to create a launch config and debug
    - Delete .vscode/launch.json
	- Press F5 and accept creation of Dart CLI config
	- Add a breakpoint to user code
	- Press F5 to begin debugging and ensure breakpoint is hit
- Ensure extension behaves correctly for a Flutter project
  - Activates correctly (SDK version appears in status bar, tooltip shows "(Flutter)")
  - No errors in dev console (Help -> Toggle Developer Tools)
  - Code completion, go-to-definition and other basic functionality work
  - Able to create a launch config and debug
    - Delete .vscode/launch.json
	- Press F5 and accept creation of Flutter mobile app config
	- Add a breakpoint to user code
	- Press F5 to begin debugging and ensure breakpoint is hit
    - Hot reload and ensure breakpoint hit again

### Deploying

- Set the version number correctly in `packages.json` (in the repository it is usually set with a `-dev` suffix)
- Add a new section to CHANGELOG.md for the new version
  - Review the GitHub milestone for completed cases
  - Scan the commit history for anything significant that didn't have a GH issue (ideally nothing)
- If this is a new major version, remove the previous changelog entries (CHANGELOG.md only contains the most recent major version with a link to the website for the rest)
- Commit theses changes and push to GitHub (pushing before completing the next step is important for the tag to be against the correct version)
- Create a new Release on GitHub with the title "Dart Code v{x.y.z}" where `{x.y.z}` is the correct version number
- Copy the installation instructions header and any preview features footer from a previous GitHub release into the release description
- Copy the changes from the CHANGELOG.md file into the release description
- Copy the changes from the CHANGELOG.md file into the Website repo (creating a new file in the releases folder if required)

To release Dart Code you will need access to the Publisher account on the VS marketplace and will need to install vsce. Follow [these instructions](https://code.visualstudio.com/docs/extensions/publish-extension) to get vsce set up and authorised with a personal access token.

- Run `vsce ls` to preview files that will be included in the release (ensure there are no artifacts/log files/etc. hanging around in your directory that haven't been excluded by `.vscodeignore`)
- **Run `vsce publish` to publish the extension**
- Open your stable version of Code (which should have Dart Code installed) and ensure it shows the update/auto-updates
  - This may take a few minutes due to caching (and stuff)
- Do some basic testing of the published release
  - If significant issues are found, they either need fixing or a new version of the extension to be re-published from the previous releases tag
- Announce the new release in [Discord](https://discord.gg/xSTPEqm)/[Gitter](https://gitter.im/dart-code/Dart-Code)/Twitter/etc.!
- Increase the version number in `packages.json` including adding a `-dev` suffix back and commit/push
