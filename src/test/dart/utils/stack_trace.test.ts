import { strict as assert } from "assert";
import { maxStackFrameMessageLength, parseStackFrame } from "../../../shared/utils/stack_trace";

const texts = [
	"",
	// Dart
	"#0      List.[] ",
	"#1      main ",
	"#2      _startIsolate.<anonymous closure> ",
	"#345    _RawReceivePortImpl._handleMessage ",
	// Flutter
	"flutter:   Builder ",
	// Flutter web
	"[_firstBuild] ",
	"<fn> ",
];
const uris = [
	"dart:async/async.dart",
	"package:test_api/test.dart",
	"dart:isolate-patch/isolate_patch.dart",
	"package:foo/foo.dart",
	"package:flutter/src/scheduler/binding.dart",
	"file:///Users/danny/Dev/flutter_gallery/lib/pages/demo.dart",
	// Flutter web
	"lib/_engine/engine/window.dart",
];
const line = 123;
const col = 45;

function getValidStackFrames(prefix: string, uri: string, withLineCol: boolean): string[] {
	return withLineCol
		? [
			// Dart/Flutter
			`${prefix}(${uri}:${line}:${col})`,
			`${prefix}(${uri}:${line}:${col}))`, // This extra closing paren exists in Dart stacks 🤷‍♂️
			// Flutter web
			`${uri} ${line}:${col}        ${prefix}`,
		]
		: [
			// Dart/Flutter
			`${prefix}(${uri})`,
			`${prefix}(${uri}))`, // This extra closing paren exists in Dart stacks 🤷‍♂️
			// Flutter web
			`${uri}        ${prefix}`,
		];
}

describe("stack trace parser", () => {
	it(`parses strings over ${maxStackFrameMessageLength} characters quickly`, () => {
		// Strings over 1000 characters skip the stack parsing regex.
		const largeString = "A".repeat(maxStackFrameMessageLength + 1);
		const startTime = Date.now();
		parseStackFrame(largeString);
		const endTime = Date.now();
		const timeTakenMilliseconds = endTime - startTime;
		console.log(`Took ${timeTakenMilliseconds}ms to parse ${largeString.length} character string`);
		assert.ok(timeTakenMilliseconds < 50);
	});

	it(`parses strings of ${maxStackFrameMessageLength} characters quickly`, () => {
		// Strings under 1000 characters are run through the regex.
		const largeString = "A".repeat(maxStackFrameMessageLength - 1);
		const startTime = Date.now();
		parseStackFrame(largeString);
		const endTime = Date.now();
		const timeTakenMilliseconds = endTime - startTime;
		console.log(`Took ${timeTakenMilliseconds}ms to parse ${largeString.length} character string`);
		assert.ok(timeTakenMilliseconds < 100, `Took ${timeTakenMilliseconds}ms to parse ${maxStackFrameMessageLength} character message`);
	});

	it(`retains URIs in the middle of lines`, () => {
		const line = "Launching lib/foo.dart on Chrome device";
		const result = parseStackFrame(line);
		assert.equal(result?.text, line);
	});

	describe("parses", () => {
		for (const text of texts) {
			for (const uri of uris) {
				for (const withLineCol of [true, false]) {
					const validStackFrames = getValidStackFrames(text, uri, withLineCol);
					for (const validStackFrame of validStackFrames) {
						it(validStackFrame, () => {
							const result = parseStackFrame(validStackFrame);
							assert.ok(result);
							const expectedText = withLineCol && text.trim() ? text.trim() : validStackFrame.trim();
							assert.equal(result.text, expectedText);
							assert.equal(result.sourceUri, uri);
							assert.equal(result.line, withLineCol ? line : undefined);
							assert.equal(result.col, withLineCol ? col : undefined);
						});
					}
				}
			}
		}
	});
});
