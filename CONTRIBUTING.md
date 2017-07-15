# Contributing to Dart Code

[![Linux & Mac build status](https://travis-ci.org/Dart-Code/Dart-Code.svg?branch=master)](https://travis-ci.org/Dart-Code/Dart-Code)
[![Windows build status](https://ci.appveyor.com/api/projects/status/github/Dart-Code/Dart-Code?branch=master&svg=true)](https://ci.appveyor.com/project/DanTup/dart-code)
[![Gitter Chat](https://img.shields.io/badge/chat-online-blue.svg)](https://gitter.im/dart-code/Dart-Code)
[![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode)
[![Contribute to Dart Code](https://img.shields.io/badge/help-contribute-551A8B.svg)](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md)
[![Contribute to Dart Code](https://img.shields.io/badge/help-donate-551A8B.svg)](https://www.paypal.me/DanTup)

If you're going to work on an issue, please add a comment to the issue so others know it's being looked at. If there isn't an issue for the work you want to do, please create one. The [up-for-grabs](https://github.com/Dart-Code/Dart-Code/labels/up%20for%20grabs) issues might make good starting points for new contributors.

## Enable Logging

There are some "hidden" configuration settings that allow you to enable diagnostic logging in order to debug/develop Dart Code more easily. These should be set to full filesystem paths of where to log. The folders must exist:

- `"dart.analyzerLogFile"`: Logs communication between Dart Code and the analysis server from the Dart SDK
- `"dart.flutterDaemonLogFile"`: Logs communication with the Flutter daemon used for device management in Dart Code
- `"dart.flutterRunLogFile"`: Logs communication with the Flutter run process used for launching and reloading Flutter applications
- `"dart.observatoryLogFile"`: Logs communication with Observatory, the Dart debugger service
- `"dart.analyzerInstrumentationLogFile"`: Instructs the analysis server to log its own instrumentation data (this is very detailed and can become very large)

Note: It is expected that Code will report that these are unknown configuration options - this is because they're not listed in the package manifest since they're not normally used by end users.

## Project Structure

Dart Code is currently written in TypeScript. There's a lot of configuration for how Code interacts with Dart Code in `package.json` though the main entry point is the `activate` method in `src/extension.ts`. Functionality is split into classes that provide small pieces of functionality via the Code APIs ([which are documented here](https://code.visualstudio.com/docs/extensionAPI/vscode-api)).

The `src/analysis` folder contains classes relating to the Dart analysis server (shipped inside the SDK) that is used for most of the langauge services in Dart Code. Some of these files are auto-generated from the [analysis server specification](https://htmlpreview.github.io/?https://github.com/dart-lang/sdk/blob/master/pkg/analysis_server/doc/api.html).

The `src/commands` folder contains commands that Dart Code handles that are not tied to API providers, such as the command executed when a debug session starts and commands added to the command palette like `pub get`.

The `src/debug` folder contains debug adapters used for communicating between Code and the Dart debugger. The Code side of this is [documented here](https://code.visualstudio.com/docs/extensionAPI/api-debugging) and the Dart/Obseravtory side is [documented here](https://github.com/dart-lang/sdk/blob/master/runtime/vm/service/service.md).

The `src/providers` folder contains the implementation for all of the providers wired up in `src/extension.ts` during activation. These provide functionality like code completion, formatting, reporting errors, etc. Most of these interact with the analysis server from the `src/analysis` folder.

The `src/services` folder contains some plumbing code for services, such as a base class for various services Dart Code uses that communicate over `STDIN`/`STDOUT` streams.

## Cloning and Running Dart Code

Running Dart Code from source is relatively straight forward. You should:

1. Clone the Dart Code repository (or your own fork)
2. Run `npm install` to fetch dependencies
3. Open the repository root folder in Visual Studio Code
4. Press F5

This will compile Dart Code and launch the Code `"Extension Development Host"`. You may see a warning in the top of the screen telling you the extension has been overwritten - this is normal; it's Code informing you that the normal installed version of the extension has been replaced by the version you just compiled. This only affects that particular session of the extension development host.

You'll now have two versions of Code open - the standard instance that has the Dart Code source code open and the extension development host which is running the extension. In the standard instance you should be able to add breakpoints in the Dart Code source code and hit them by using Dart Code in the extension development host, with the exception of the debug adapters (see below). If you make code changes you'll want to click the `Restart` button in the standard instance (or press `Ctrl+Shift+F5`) in order to reload changes.

## Debugging the Debug Adapters

In order to debug the debug adapters you need to run them in a `"server mode"`. This mode starts the debug adapters at extension activation time and keeps them open for the whole session. You'll also need to ensure that when you start the debug session from within Dart Code you have configured it to connect to this debug session.

1. In the main Code instance, switch to the `Debug` pane
2. In the configuration dropdown, choose the configuration named `Extension + Dart Server` or `Extension + Flutter Server`
3. Press `F5` to launch the extension development host running the extension and also the debug server
4. In the extension development host, open the `launch.json` file for the Dart project you're going to debug
5. Add `"debugServer": 4711` to the debug configuration to instruct Dart Code to use the debug server (note: don't forget to remove this later, otherwise you'll get errors when trying to debug if there's no debug server running)
6. Press `F5` in the extension development host to begin debugging

In this mode, you should be able to hit breakpoints in the debug adapters too. The debug toolbar in the main instance will allow you to switch between the extension/debug server processes and you should see the status of both in the debugging panes.

## Code Etiquette and Style

- If you end up with a large number of commits for tidying up/fixing, consider squashing
- If your branch lives for a long time, rebase on top of `master` before sending pull requests to ensure any conflicts are dealt with
- Try to keep the bulk of work out of `extension.ts` by creating new files/classes but do keep the wire-up code in `extension.ts` as a central place to track what's set up
- Code Style
  - All files should start with `"use strict";`
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
