import * as os from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import { BasicDebugConfiguration } from "../../shared/debug/interfaces";
import { escapeRegExp } from "../../shared/utils";
import { OpenedFileInformation, Position } from "../interfaces";
import { GroupNode, SuiteNode, TestNode, TreeNode } from "../test/test_model";
import { fsPath, getRandomInt } from "./fs";
import { TestOutlineInfo } from "./outline";

export function getLaunchConfig(noDebug: boolean, includeCoverage: boolean, isFlutter: boolean, programPath: string, testSelection: TestSelection[] | undefined, shouldRunTestByLine: boolean, runSkippedTests: boolean | undefined, template: any | undefined, workspacePackageNames?: string[]): { program: string } & BasicDebugConfiguration {
	let programString = programPath;
	let toolArgs: string[] = [];
	if (template?.toolArgs)
		toolArgs = toolArgs.concat(template?.toolArgs as []);
	if (testSelection) {
		const execInfo = getTestExecutionInfo(programString, testSelection, shouldRunTestByLine);
		programString = getProgramString(execInfo.programUri);
		toolArgs.push(...execInfo.args);
	}
	if (runSkippedTests)
		toolArgs.push("--run-skipped");
	if (includeCoverage && isFlutter) {
		const coverageFilePath = path.join(os.tmpdir(), `flutter-coverage-${getRandomInt(0x1000, 0x10000).toString(16)}.lcov`);
		toolArgs.push("--coverage");
		toolArgs.push("--branch-coverage");
		toolArgs.push("--coverage-path");
		toolArgs.push(coverageFilePath);
		if (workspacePackageNames) {
			for (const packageName of workspacePackageNames) {
				toolArgs.push("--coverage-package", `^${escapeRegExp(packageName)}$`);
			}
		}

		template ??= {};
		template.coverageFilePath = coverageFilePath;
	}

	return Object.assign(
		{
			// Trailing space is a workaround for https://github.com/microsoft/vscode/issues/100115
			name: "Tests ",
			noDebug,
			request: "launch",
			type: "dart",
		},
		template,
		{
			args: template?.args,
			expectSingleTest: testSelection?.length === 1 && !testSelection[0].name.includes("$") && !testSelection[0].isGroup,
			program: programString,
			toolArgs,
		},
	) as { program: string } & BasicDebugConfiguration;
}

export interface TestSelection { name: string, isGroup: boolean, position: Position | undefined }

const regexEscapedInterpolationExpressionPattern = /\\\$(?:(?:\w+)|(?:\\\{.*\\\}))/g;
export function makeRegexForTests(names: TestSelection[]) {
	const regexSegments: string[] = [];
	for (const name of names) {
		const prefix = "^";
		// We can't anchor to the end for groups, as we want them to run all children.
		const suffix = name.isGroup ? "" : "( \\(variant: .*\\))?$";
		let escapedName = escapeRegExp(name.name);

		// Replace any literal newlines with \n because literals can cause
		// issues in the shell.
		// https://github.com/Dart-Code/Dart-Code/issues/4007
		escapedName = escapedName
			.replace(/\n/g, "\\n")
			.replace(/\r/g, "\\r");

		// If a test name contains interpolated expressions, passing the exact
		// name won't match. So we just replace them out with wildcards. We'll need
		// to do this after escaping for regex, to ensure the original expression
		// is escaped but our wildcard is not.
		const substitutedName = escapedName.replace(regexEscapedInterpolationExpressionPattern, ".*");
		regexSegments.push(`${prefix}${substitutedName}${suffix}`);
	}

	return regexSegments.join("|");
}

export function getTestExecutionInfo(programPath: string, tests: TestSelection[], shouldRunTestByLine: boolean): { programUri: URI, args: string[] } {
	if (shouldRunTestByLine && tests.length && tests.every((test) => test.position)) {
		return {
			// VS Code lines are 0-based, but Dart is 1-based.
			args: tests.slice(1).map(((test) => `${programPath}?line=${test.position!.line + 1}`)),
			programUri: URI.file(programPath).with({ query: `?line=${tests[0].position!.line + 1}` }),
		};
	}
	return {
		args: ["--name", makeRegexForTests(tests)],
		programUri: URI.file(programPath),
	};
}

export function getProgramString(programUri: URI) {
	return programUri.query ? `${fsPath(programUri)}${programUri.query}` : fsPath(programUri);
}

export function getProgramPath(program: string) {
	return program.split("?")[0];
}

export function getTestSelectionForNodes(nodes: TreeNode[]): TestSelection[] | undefined {
	if (nodes.find((node) => node instanceof SuiteNode))
		return undefined;

	return (nodes as Array<GroupNode | TestNode>).map((node) => getTestSelectionForNode(node));
}

function getTestSelectionForNode(treeNode: GroupNode | TestNode): TestSelection {
	return { name: treeNode.name!, isGroup: treeNode instanceof GroupNode, position: treeNode.range?.start };
}

export function getTestSelectionForOutline(test: TestOutlineInfo): TestSelection {
	const position = test.range.start;
	return { name: test.fullName, isGroup: test.isGroup, position };
}

export const createTestFileAction = (file: string) => `Create ${path.basename(file)}`;
export const defaultTestFileContents = (isFlutterProject: boolean, dartEscapedTestName: string) => isFlutterProject ? defaultFlutterTestFileContents(dartEscapedTestName) : defaultDartTestFileContents(dartEscapedTestName);

const defaultTestFileSelectionPlaceholder = "// TODO: Implement test";

function defaultFlutterTestFileContents(dartEscapedTestName: string): OpenedFileInformation {
	const contents = `
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('${dartEscapedTestName} ...', (tester) async {
    ${defaultTestFileSelectionPlaceholder}
  });
}
`.trim();
	return {
		contents,
		selectionLength: defaultTestFileSelectionPlaceholder.length,
		selectionOffset: contents.indexOf(defaultTestFileSelectionPlaceholder),
	};
}

export function defaultDartTestFileContents(dartEscapedTestName: string): OpenedFileInformation {
	const contents = `
import 'package:test/test.dart';

void main() {
  test('${dartEscapedTestName} ...', () async {
    ${defaultTestFileSelectionPlaceholder}
  });
}
`.trim();
	return {
		contents,
		selectionLength: defaultTestFileSelectionPlaceholder.length,
		selectionOffset: contents.indexOf(defaultTestFileSelectionPlaceholder),
	};
}

export function extractTestNameFromOutline(elementName: string): string | undefined {
	if (!elementName)
		return;
	// Strip off the function name/parent like test( or testWidget(
	const openParen = elementName.indexOf("(");
	const closeParen = elementName.lastIndexOf(")");
	if (openParen === -1 || closeParen === -1 || openParen >= closeParen)
		return;

	elementName = elementName.substring(openParen + 2, closeParen - 1);

	// For tests with variables, we often end up with additional quotes wrapped
	// around them...
	if ((elementName.startsWith("'") || elementName.startsWith('"')) && (elementName.endsWith("'") || elementName.endsWith('"')))
		elementName = elementName.substring(1, elementName.length - 1);

	return elementName;
}

export function isSetupOrTeardownTestName(testName: string | undefined): boolean {
	return !!((testName?.startsWith("(setUp") || testName?.startsWith("(tearDown")) && testName?.endsWith(")"));
}
