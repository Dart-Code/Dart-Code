import * as path from "path";
import { escapeRegExp } from "../../shared/utils";
import { OpenedFileInformation } from "../interfaces";

export function getLaunchConfig(noDebug: boolean, path: string, testNames: string[] | undefined, isGroup: boolean, template?: any | undefined) {
	const templateArgs = template?.args || [];
	const testNameArgs = testNames
		? ["--name", makeRegexForTests(testNames, isGroup)]
		: [];
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
			args: templateArgs.concat(testNameArgs),
			program: path,
		},
	);
}

const regexEscapedInterpolationExpressionPattern = /\\\$(?:(?:\w+)|(?:\\\{.*\\\}))/g;
export function makeRegexForTests(names: string[], isGroup: boolean) {
	const regexSegments: string[] = [];
	for (const name of names) {
		const prefix = "^";
		// We can't anchor to the end for groups, as we want them to run all children.
		const suffix = isGroup ? "" : "$";
		const escapedName = escapeRegExp(name);

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
