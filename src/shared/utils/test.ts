import * as path from "path";
import { BasicDebugConfiguration } from "../../shared/debug/interfaces";
import { escapeRegExp } from "../../shared/utils";
import { OpenedFileInformation } from "../interfaces";

export function getLaunchConfig(noDebug: boolean, path: string, testNames: TestName[] | undefined, runSkippedTests?: boolean, template?: any | undefined): BasicDebugConfiguration {
	let toolArgs: string[] = [];
	if (template?.toolArgs)
		toolArgs = toolArgs.concat(template?.toolArgs);
	if (testNames) {
		toolArgs.push("--name");
		toolArgs.push(makeRegexForTests(testNames));
	}
	if (runSkippedTests)
		toolArgs.push("--run-skipped");

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
			expectSingleTest: testNames?.length === 1 && !testNames[0].name.includes("$") && !testNames[0].isGroup,
			program: path,
			toolArgs,
		},
	);
}

export interface TestName { name: string, isGroup: boolean }

const regexEscapedInterpolationExpressionPattern = /\\\$(?:(?:\w+)|(?:\\\{.*\\\}))/g;
export function makeRegexForTests(names: TestName[]) {
	const regexSegments: string[] = [];
	for (const name of names) {
		const prefix = "^";
		// We can't anchor to the end for groups, as we want them to run all children.
		const suffix = name.isGroup ? "" : "( \\(variant: .*\\))?$";
		const escapedName = escapeRegExp(name.name);

		// If a test name contains interpolated expressions, passing the exact
		// name won't match. So we just replace them out with wildcards. We'll need
		// to do this after escaping for regex, to ensure the original expression
		// is escaped but our wildcard is not.
		const substitutedName = escapedName.replace(regexEscapedInterpolationExpressionPattern, ".*");
		regexSegments.push(`${prefix}${substitutedName}${suffix}`);
	}

	return regexSegments.join("|");
}

export const createTestFileAction = (file: string) => `Create ${path.basename(file)}`;
export const defaultTestFileContents = (isFlutterProject: boolean, dartEscapedTestName: string) => isFlutterProject ? defaultFlutterTestFileContents(dartEscapedTestName) : defaultDartTestFileContents(dartEscapedTestName);

const defaultTestFileSelectionPlaceholder = "// TODO: Implement test";

export function defaultFlutterTestFileContents(dartEscapedTestName: string): OpenedFileInformation {
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
