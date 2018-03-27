# v2.11.0

## Flutter Test

Basic support for `flutter test` has been added. If you launch a file (by pressing `F5` with no launch config, or by setting `program` in your launch config) that is inside the `test` folder of a Flutter project, the script will be run using `flutter run`. Output will appear in the `Debug Console` pane. All debugging functionality (breakpoints, etc.) should work as normal.

![Flutter Test](https://dartcode.org/images/release_notes/v2.11/flutter_test.png)

## Projects in Sub-Folders

When projects are found in sub-folders you will now be prompted to mark them as `Workspace folders`. This will allow Dart Code to better understand which folders are projects when detecting which debugger to run when pressing F5.

![Projects in Sub-Folders](https://dartcode.org/images/release_notes/v2.11/workspace_upgrade.png)

**Note:** VS Code will duplicate these workspace folders in the top level of explorer - please +1 [this VS Code issue](https://github.com/Microsoft/vscode/issues/45470) to allow this to be configurable.

## Silent Extension Reloads

Many operations in Dart Code require re-initialising the extension. This was previously done by prompting the user to `"Reload Window"` which resulted in a visible disruption and all extensions re-initialising. In this version Dart Code silently re-initialises itself meaning no more prompts for actions such as changing SDKs. Since this operation still terminates and restarts the Dart analysis server it may take a few moments to re-analyze your project.

## SDK Picker for Flutter

The Flutter version number now appears on the status bar and allows quickly switching SDKs by clicking onit (this functionality already existed for Dart). Set the `dart.flutterSdkPaths` setting to an array of SDK folders (or folders containing SDKs) to use this. Note: This does not change your Flutter channel but relies on having multiple versions of the SDK in different folders (you can do this without multiple clones by using `git worktree` [as shown in our Travis script](https://github.com/Dart-Code/Dart-Code/blob/b5da182903119232eb74d1dc69d5ae878ca41341/.travis.yml#L39-L41)).

![SDK Picker for Flutter](https://dartcode.org/images/release_notes/v2.11/flutter_sdk_switcher.png)

## Other Changes

- `dart.previewDart2` now explicitly sends `--no-preview-dart-2` when set to `false` to allow opting-out of the Dart 2 preview once it becomes the default in Flutter Beta 2 (if undefined, neither flag will be sent)
- The setting `dart.previewDart2` now works for Dart CLI apps in addition to Flutter (note: your Dart SDK must support it, which currently means you must be using a v2.0 dev release)
- Pressing F5 without a `launch.json` will now launch more scripts without configuration (scripts inside `test`, `bin` and `tool`)
- Errors when launching Flutter projects (such as when you have not accepted Android licenses) will now appear in the Debug Console
- Flutter's `Full Restart` is now bound to `Ctrl`+`F5` by default during a debugging session
- `Flutter: New Project` will now validate that you do not call your project `flutter` or `flutter_test` which would lead to confusing errors about depending on itself
- The `flutter/flutter` repository will once again be treated as a Flutter project rather than a Dart one, meaning it will use Flutter's version of the Dart SDK and start the `flutter daemon`
- The extension will no longer crash if you try to opened a Flutter project without a Flutter SDK but with a Dart SDK in your `PATH`
- The display of the workspace symbols has been updated to include file paths in addition to class names
- The document symbol list will no longer list constructor invocations within Flutter projects
- The document symbol list (`Ctrl`+`Shift`+`O`) now uses the same API as the workspace symbol list (as updated in the previous version) when your SDK supports it, resulting in more consistent rendering between document/workspace lists
- Running `Pub: Get Packages`, `Pub: Upgrade Packages`, `Flutter: Get Packages` or `Flutter: Upgrade Packages` directly from the command palette will now switch between `flutter` and `pub` based on the project type
- Commands like `Pub: Get Packages` will no longer fail if your Dart SDK is in a folder with parentheses in the name
- Code completion will no longer insert unwanted parentheses or colons that already exist ahead of the cursor when typing quickly
- Code completion for named arguments will no longer insert placeholders but instead automatically re-trigger code completion where the value should be provided
- Dart and Flutter version numbers will no longer show in the status bar when the active file is not a Dart file
- The SDK quick-picker will now include your current SDK even if it's not included via the `dart.sdkPaths`/`dart.flutterSdkPaths` settings
- The SDK quick-picker will now longer show an error if configured folders contain symlinks to Dart binaries
- A new option (`dart.vmAdditionalArgs`) has been added to pass custom arguments to the VM when launching Dart CLI apps
- Code completion will no longer get stuck open after typing `@override`

## Preview Features available in this version

- [`dart.previewAnalyzeAngularTemplates`](https://github.com/Dart-Code/Dart-Code/issues/396) - Enables analysis for AngularDart templates (requires the [angular_analyzer_plugin](https://github.com/dart-lang/angular_analyzer_plugin))

# Past Versions

For full release notes of previous versions, see [dartcode.org/releases](https://dartcode.org/releases/).
