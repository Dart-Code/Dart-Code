import * as os from "os";
import * as path from "path";
import { URI } from "vscode-uri";
import { DartTestCapabilities } from "../capabilities/dart_test";
import { BasicDebugConfiguration } from "../debugging/interfaces";
import { OpenedFileInformation, Position } from "../interfaces";
import { GroupNode, SuiteNode, TestNode, TreeNode } from "../test/test_model";
import { escapeRegExp } from "../utils";
import { fsPath, getRandomInt } from "./fs";
import { TestOutlineInfo } from "./outline";

export function getLaunchConfig(noDebug: boolean, includeCoverage: boolean, isFlutter: boolean, programPath: string, testSelection: TestSelection[] | undefined, shouldRunTestByLine: boolean, runSkippedTests: boolean | undefined, template: Record<string, unknown> | undefined, dartTestCapabilities: DartTestCapabilities | undefined, workspacePackageNames?: string[]): { program: string } & BasicDebugConfiguration {
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
	if (includeCoverage) {
		const coverageFilePath = path.join(os.tmpdir(), `coverage-${getRandomInt(0x1000, 0x10000).toString(16)}.lcov`);

		toolArgs.push("--branch-coverage");
		toolArgs.push("--coverage-path");
		toolArgs.push(coverageFilePath);

		// Flutter requires this additional flag.
		if (isFlutter)
			toolArgs.push("--coverage");

		if (workspacePackageNames && (isFlutter || dartTestCapabilities?.supportsCoveragePackage)) {
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
	);
}

export interface TestNameSegment {
	name: string;
	isDynamic: boolean;
}

export interface TestSelection {
	/// Whether this node is a test that wasn't discovered inside the top
	/// level `main()` function which means we need to skip adding `^` to
	/// the start of the regex.
	isOutlineNodeNotFromMainFunction?: boolean,
	isDynamic?: boolean,
	segments?: TestNameSegment[],
	name: string,
	isGroup: boolean,
	position: Position | undefined
}

function escapeLiteralTestNameText(text: string): string {
	// Replace any literal newlines with \n because literals can cause
	// issues in the shell.
	// https://github.com/Dart-Code/Dart-Code/issues/4007
	return escapeRegExp(text)
		.replace(/\n/g, "\\n")
		.replace(/\r/g, "\\r");
}

function skipDartStringLiteral(text: string, quoteIndex: number, isRaw: boolean): number | undefined {
	const quote = text[quoteIndex];
	const isTriple = text.startsWith(quote.repeat(3), quoteIndex);
	const delimiterLength = isTriple ? 3 : 1;
	let i = quoteIndex + delimiterLength;

	while (i < text.length) {
		if (isTriple) {
			if (text.startsWith(quote.repeat(3), i))
				return i + 3;
		} else {
			if (text[i] === quote)
				return i + 1;
			if (text[i] === "\n" || text[i] === "\r")
				return undefined;
		}

		if (!isRaw && text[i] === "\\") {
			if (i + 1 >= text.length)
				return undefined;
			i += 2;
			continue;
		}

		if (!isRaw && text[i] === "$" && text[i + 1] === "{") {
			const braceEnd = findMatchingBraceEnd(text, i + 1);
			if (braceEnd === undefined)
				return undefined;
			i = braceEnd;
			continue;
		}

		i++;
	}

	return undefined;
}

function findMatchingBraceEnd(text: string, openBraceIndex: number): number | undefined {
	let i = openBraceIndex + 1;
	let depth = 1;

	while (i < text.length) {
		const ch = text[i];

		if (ch === "/" && text[i + 1] === "/") {
			const nextNewline = text.indexOf("\n", i + 2);
			if (nextNewline === -1)
				return undefined;
			i = nextNewline + 1;
			continue;
		}

		if (ch === "/" && text[i + 1] === "*") {
			const commentEnd = text.indexOf("*/", i + 2);
			if (commentEnd === -1)
				return undefined;
			i = commentEnd + 2;
			continue;
		}

		if (ch === "r" && (text[i + 1] === "'" || text[i + 1] === "\"") && (i === 0 || !/\w/.test(text[i - 1]))) {
			const stringEnd = skipDartStringLiteral(text, i + 1, true);
			if (stringEnd === undefined)
				return undefined;
			i = stringEnd;
			continue;
		}

		if (ch === "'" || ch === "\"") {
			const stringEnd = skipDartStringLiteral(text, i, false);
			if (stringEnd === undefined)
				return undefined;
			i = stringEnd;
			continue;
		}

		if (ch === "{") {
			depth++;
		} else if (ch === "}") {
			depth--;
			if (depth === 0)
				return i + 1;
		}

		i++;
	}

	return undefined;
}

function findDartInterpolationEnd(text: string, dollarIndex: number): number | undefined {
	const next = text[dollarIndex + 1];
	if (!next)
		return undefined;

	if (/[A-Za-z_]/.test(next)) {
		let end = dollarIndex + 2;
		while (end < text.length && /\w/.test(text[end]))
			end++;
		return end;
	}

	if (next === "{")
		return findMatchingBraceEnd(text, dollarIndex + 1);

	return undefined;
}

export function hasDartInterpolation(text: string): boolean {
	for (let i = text.indexOf("$"); i !== -1; i = text.indexOf("$", i + 1)) {
		if (findDartInterpolationEnd(text, i) !== undefined)
			return true;
	}
	return false;
}

function escapeTestNameSegment(segmentName: string, isDynamic: boolean): string {
	if (!isDynamic)
		return escapeLiteralTestNameText(segmentName);

	// If a test name contains interpolated expressions, passing the exact
	// name won't match. Tokenize each interpolation separately so literal text
	// between interpolations stays escaped rather than being swallowed into one
	// greedy wildcard.
	const parts: string[] = [];
	let literalStart = 0;
	let dollarIndex = segmentName.indexOf("$");
	while (dollarIndex !== -1) {
		const interpolationEnd = findDartInterpolationEnd(segmentName, dollarIndex);
		if (interpolationEnd === undefined) {
			dollarIndex = segmentName.indexOf("$", dollarIndex + 1);
			continue;
		}

		if (dollarIndex > literalStart)
			parts.push(escapeLiteralTestNameText(segmentName.slice(literalStart, dollarIndex)));
		if (parts[parts.length - 1] !== ".*")
			parts.push(".*");

		literalStart = interpolationEnd;
		dollarIndex = segmentName.indexOf("$", interpolationEnd);
	}

	if (literalStart < segmentName.length)
		parts.push(escapeLiteralTestNameText(segmentName.slice(literalStart)));

	return parts.join("");
}

export function makeRegexForTests(names: TestSelection[]) {
	const regexSegments: string[] = [];
	for (const name of names) {
		const prefix = name.isOutlineNodeNotFromMainFunction ? "" : "^";
		// We can't anchor to the end for groups, as we want them to run all children.
		const suffix = name.isGroup ? "" : "( \\(variant: .*\\))?$";
		const substitutedName = name.segments?.length
			? name.segments.map((segment) => escapeTestNameSegment(segment.name, segment.isDynamic)).join(" ")
			: escapeTestNameSegment(name.name, name.isDynamic !== false);
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
	return { isDynamic: treeNode.hasDynamicName, segments: treeNode.nameSegments, name: treeNode.name!, isGroup: treeNode instanceof GroupNode, position: treeNode.range?.start };
}

export function getTestSelectionForOutline(test: TestOutlineInfo): TestSelection {
	const position = test.range.start;
	return { isDynamic: test.isDynamic, segments: test.segments, isOutlineNodeNotFromMainFunction: test.isOutlineNodeNotFromMainFunction, name: test.fullName, isGroup: test.isGroup, position };
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

export function parseTestNameFromOutline(elementName: string): TestNameSegment | undefined {
	if (!elementName)
		return;
	// Strip off the function name/parent like test( or testWidget(.
	const openParen = elementName.indexOf("(");
	const closeParen = elementName.lastIndexOf(")");
	if (openParen === -1 || closeParen === -1 || openParen >= closeParen)
		return;

	elementName = elementName.substring(openParen + 2, closeParen - 1);

	// For tests with variables/interpolations, the analyzer cannot compute a
	// constant stringValue and falls back to toSource(), leaving Dart string
	// quotes wrapped around the description (unlike literal/escaped/raw strings
	// such as 'price \$5' or r'price $5', where stringValue is unquoted).
	let unparenthesized = elementName;
	while (unparenthesized.startsWith("(") && unparenthesized.endsWith(")") && unparenthesized.length >= 2)
		unparenthesized = unparenthesized.substring(1, unparenthesized.length - 1).trim();

	const startsWithQuote = unparenthesized.startsWith("'") || unparenthesized.startsWith("\"") || unparenthesized.startsWith("r'") || unparenthesized.startsWith("r\"");
	const endsWithQuote = unparenthesized.endsWith("'") || unparenthesized.endsWith("\"");
	const minQuotedLength = unparenthesized.startsWith("r") ? 3 : 2;
	const hasSourceQuotes = startsWithQuote && endsWithQuote && unparenthesized.length >= minQuotedLength;

	if ((elementName.startsWith("'") || elementName.startsWith("\"")) && (elementName.endsWith("'") || elementName.endsWith("\"")) && elementName.length >= 2)
		elementName = elementName.substring(1, elementName.length - 1);

	return {
		isDynamic: hasSourceQuotes && hasDartInterpolation(elementName),
		name: elementName,
	};
}

export function extractTestNameFromOutline(elementName: string): string | undefined {
	return parseTestNameFromOutline(elementName)?.name;
}

export function isSetupOrTeardownTestName(testName: string | undefined): boolean {
	return !!(testName && (testName.startsWith("(setUp") || testName.startsWith("(tearDown")) && testName.endsWith(")"));
}
