[![Linux & Mac build status](https://img.shields.io/travis/Dart-Code/Dart-Code/master.svg?label=mac+%26+linux)](https://travis-ci.org/Dart-Code/Dart-Code) [![Windows build status](https://img.shields.io/appveyor/ci/DanTup/Dart-Code/master.svg?label=windows&logoWidth=-1)](https://ci.appveyor.com/project/DanTup/dart-code) [![Gitter Chat](https://img.shields.io/badge/chat-online-blue.svg)](https://gitter.im/dart-code/Dart-Code) [![Follow on Twitter](https://img.shields.io/badge/twitter-dartcode-blue.svg)](https://twitter.com/DartCode) [![Contribute to Dart Code](https://img.shields.io/badge/help-contribute-551A8B.svg)](https://github.com/Dart-Code/Dart-Code/blob/master/CONTRIBUTING.md)

## Introduction

Dart Code extends [VS Code](https://code.visualstudio.com/) with support for the
[Dart](https://www.dartlang.org/) programming language, and provides tools for
effectively editing, refactoring, running, and reloading [Flutter](https://flutter.io/)
mobile apps, and [AngularDart](https://angulardart.org) web apps.

## Installation

Dart Code can be [installed from the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=Dart-Code.dart-code). Open VS Code Quick Open (`Ctrl+P`) and paste the following and press enter:

    ext install dart-code


## Features

- Debug Dart command line apps
- Debug Flutter mobile apps
- Support for flutter `hot reload` (use the debugger `Restart` button)
- Select from multiple devices for Flutter debugging (select from the status bar)
- Support for debugging "just my code" or SDK/libraries too (`dart.debugSdkLibraries` and `dart.debugExternalLibraries`)
- Automatically finds Dart and Flutter SDKs from `PATH` or workspace folders
- Notification of new stable Dart SDK releases
- Syntax highlighting
- Code completion
- Snippets
- Realtime errors/warnings/TODOs reported in problems window and with squiggles
- Hovers/tooltip information
- Go to Definition
- Find References
- Code fixes/lightbulb
- Type hierarchy
- Rename refactoring
- Organize directives
- Sort members
- Flutter Doctor command
- Format document
- Support for format-on-save (`editor.formatOnSave`)
- Support for format-on-type (`editor.formatOnType`)
- Workspace-wide symbol search
- Automatic closing braces/quotes
- Document symbol list/search with highlighting
- Generation of analysis error reports for easy reporting to the Dart team 
- `pub get` and `pub upgrade` commands (and flutter equivilents)
- Automatically run `pub get` when `pubspec.yaml` is saved
- Supports strong mode and linting (configured in `analysis_options.yaml` or `.analysis_options`)
- Other references to symbol under cursor are highlighted


## Extension Settings

- `dart.allowAnalytics`: Whether to send analytics such as startup timings, frequency of use of features and analysis server crashes. Defaults to `true`.
- `dart.closingLabels`: Whether to show annotations against constructor, method invocations and lists that span multiple lines. Defaults to `true`. 
- `dart.checkForSdkUpdates`: Whether to check you are using the latest version of the Dart SDK at startup. Defaults to `true`.
- `dart.debugSdkLibraries`: Whether SDK libraries should be marked as debuggable. Defaults to `false`.
- `dart.debugExternalLibraries`: Whether libraries should be marked as debuggable. Defaults to `false`.
- `dart.flutterHotReloadOnSave`: Whether to automatically send a 'hot reload' request during a Flutter debug session when saving files. Defaults to `true`.
- `dart.flutterSdkPath`: Override the detected Flutter SDK to allow you to run from another location.
- `dart.insertArgumentPlaceholders`: Whether to insert argument placeholders during code completions. Defaults to `true`.
- `dart.lineLength`: The maximum length of a line of code. This is used by the document formatter. Defaults to `80`.
- `dart.pubAdditionalArgs`: Additional args to pass to `pub get` and `pub upgrade` commands (eg. `--packages-dir`).
- `dart.runPubGetOnPubspecChanges`: Whether to automatically run `pub get` whenever pubspec.yaml is saved. Defaults to `true`.
- `dart.promptToGetPackages`: Whether to prompt to get packages when opening a project with out of date packages. Defaults to `true`.
- `dart.sdkPath`: If the Dart SDK is not automatically found on your machine from your `PATH` you can enter the path to it here.
- `dart.sdkPaths`: If you often switch between multiple Dart SDKs, setting this option to an array of Dart SDK folders or folders that contain multiple Dart SDKs in sub-folders will allow fast switching by clicking the Dart SDK version in the status bar.
- `dart.flutterSdkPaths`: If you often switch between multiple Flutter SDKs/channels, setting this option to an array of Flutter SDK folders or folders that contain multiple Flutter SDKs in sub-folders will allow fast switching by clicking the Flutter SDK version in the status bar.
- `dart.showLintNames`: Whether to show the names of linter rules in the problems panel to make it easier to `// ignore:`.
- `dart.showTodos`: Whether to show TODOs in the Problems list. Defaults to `true`.
- `dart.vmAdditionalArgs`: Additional args to pass to the Dart VM when running/debugging apps.


## Custom Colors

Some colors in Dart Code can be customised using the `workbench.colourCustomizations` section in settings. Supported colors are:

- `dart.closingLabels` - The color of the "closing label" annotations against constructor, method invocations and lists that span multiple lines


## Refactorings and Code Fixes

`Ctrl`+`.` in Code opens the "lightbulb" menu showing all code fixes/refactors. Code v1.20 [gained the ability to keybind quickfixes](https://code.visualstudio.com/updates/v1_20#_keybindings-for-quick-fixes-and-code-actions). To do this you should edit your `keybindings.json` file and include the ID of the refactor as found below. If the `kind` for the keybind is set to just a segment of the ID (for example 'refactor.surround') then all actions sharing that prefix will appear in a filtered menu (or if only one, the action invoked immediately). You can control this behaviour with the `apply` argument [see docs](https://code.visualstudio.com/updates/v1_20#_keybindings-for-quick-fixes-and-code-actions).

The list of refactors comes from the Dart analysis server and therefore may change over time. Once this list is available somewhere centrally the readme will be updated to link there.

Note: These IDs are only provided by recent versions of the Dart analysis server and will not work with older/v1 builds.

- `refactor.addPartDirective` - Add 'part' directive  
- `refactor.addTypeAnnotation` - Add type annotation  
- `refactor.assignToVariable` - Assign value to new local variable  
- `refactor.convert.blockComment` - Convert to block documentation comment  
- `refactor.convert.lineComment` - Convert to line documentation comment  
- `refactor.convert.bodyToAsync` - Convert to async function body    
- `refactor.convert.bodyToBlock` - Convert to block body  
- `refactor.convert.bodyToExpression` - Convert to expression body  
- `refactor.convert.forEachToForIndex` - Convert to for-index loop  
- `refactor.convert.getterToFinalField` - Convert to final field  
- `refactor.convert.toGenericFunctionSyntax` - Convert into 'Function' syntax  
- `refactor.convert.finalFieldToGetter` - Convert to getter  
- `refactor.convert.isNot` - Convert to is!  
- `refactor.convert.isNotEmpty` - Convert to 'isNotEmpty'  
- `refactor.convert.partOfToPartUri` - Convert to use a URI  
- `refactor.convert.toDoubleQuotedString` - Convert to double quoted string  
- `refactor.convert.toConstructorFieldParameter` - Convert to field formal parameter  
- `refactor.convert.toConstructorNormalParameter` - Convert to normal parameter  
- `refactor.convert.toSingleQuotedString` - Convert to single quoted string  
- `refactor.encapsulateField` - Encapsulate field  
- `refactor.exchangeOperands` - Exchange operands  
- `refactor.extractClass` - Extract class into file
- `refactor.flutter.convert.childToChildren` - Convert to children:  
- `refactor.flutter.convert.toStatefulWidget` - Convert to StatefulWidget  
- `refactor.flutter.move.down` - Move widget down  
- `refactor.flutter.move.up` - Move widget up  
- `refactor.flutter.removeWidget` - Remove widget  
- `refactor.flutter.swap.withChild` - Swap with child  
- `refactor.flutter.swap.withParent` - Swap with parent  
- `refactor.flutter.wrap.center` - Center widget  
- `refactor.flutter.wrap.column` - Wrap with Column  
- `refactor.flutter.wrap.generic` - Wrap with new widget  
- `refactor.flutter.wrap.padding` - Add padding  
- `refactor.flutter.wrap.row` - Wrap with Row  
- `refactor.addShowCombinator` - Add explicit 'show' combinator  
- `refactor.introduceLocalCast` - Introduce new local with tested type  
- `refactor.invertIf` - Invert 'if' statement  
- `refactor.joinWithInnerIf` - Join 'if' statement with inner 'if' statement  
- `refactor.joinWithOuterIf` - Join 'if' statement with outer 'if' statement  
- `refactor.joinVariableDeclaration` - Join variable declaration  
- `refactor.removeTypeAnnotation` - Remove type annotation  
- `refactor.convert.conditionalToIfElse` - Replace conditional with 'if-else'  
- `refactor.convert.ifElseToConditional` - Replace 'if-else' with conditional ('c ? x : y')  
- `refactor.splitIfConjunction` - Split && condition  
- `refactor.splitVariableDeclaration` - Split variable declaration  
- `refactor.surround.block` - Surround with block  
- `refactor.surround.doWhile` - Surround with 'do-while'  
- `refactor.surround.forEach` - Surround with 'for'  
- `refactor.surround.forIn` - Surround with 'for-in'  
- `refactor.surround.if` - Surround with 'if'  
- `refactor.surround.tryCatch` - Surround with 'try-catch'  
- `refactor.surround.tryFinally` - Surround with 'try-finally'  
- `refactor.surround.while` - Surround with 'while'


## Analytics

This extension reports some analytics such as:

- Extension load and analysis times
- Whether you have disabled some settings (such as showing TODOs in Problems Window or Closing Labels)
- Frequency of use of features like Hot Reload, Full Restart and Open Observatory
- Crashes in the Dart analysis server
- Platform and Dart/Flutter SDK versions

Reporting can be disabled via the `dart.allowAnalytics` setting.


## Release Notes

For full release notes, see [the changelog](https://github.com/Dart-Code/Dart-Code/blob/master/CHANGELOG.md).
