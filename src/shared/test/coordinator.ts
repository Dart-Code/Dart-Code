import { URI } from "vscode-uri";
import { Outline } from "../analysis/lsp/custom_protocol";
import { isWin } from "../constants";
import { IAmDisposable, Logger, Range } from "../interfaces";
import { ErrorNotification, GroupNotification, Notification, PrintNotification, SuiteNotification, TestDoneNotification, TestStartNotification } from "../test_protocol";
import { disposeAll, maybeUriToFilePath, uriToFilePath } from "../utils";
import { normalizeSlashes } from "../utils/fs";
import { TestOutlineVisitor } from "../utils/outline";
import { isSetupOrTeardownTestName } from "../utils/test";
import { SuiteData, TestModel, TestSource } from "./test_model";

/// Handles results from a test debug session and provides them to the test model.
export class TestSessionCoordinator implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	/// A link between a suite path and the debug session ID that owns it, so we can ensure
	/// it is correctly ended when the debug session ends, even if we don't get the correct
	/// end events.
	private owningDebugSessions: { [key: string]: string | undefined } = {};

	/// For a given debug session, lookups by IDs to get back to the suite.
	private debugSessionLookups: {
		[key: string]: {
			suiteForID: { [key: string]: SuiteData | undefined },
			suiteForTestID: { [key: string]: SuiteData | undefined },
		} | undefined
	} = {};

	/// A link between a suite path and a visitor for visiting its latest outline data.
	/// This data is refreshed when a test suite starts running.
	private suiteOutlineVisitors: { [key: string]: TestOutlineVisitor | undefined } = {};

	/// For each debug session ID, stores a mapping of phantom (empty) groups and their parent IDs so we can
	/// jump over them.
	private phantomGroupParents: { [key: string]: { [key: number]: number | null | undefined } } = {};

	constructor(private readonly logger: Logger, private readonly data: TestModel, private readonly fileTracker: { getOutlineFor(uri: URI): Outline | undefined }) { }

	public handleDebugSessionCustomEvent(debugSessionID: string, dartCodeDebugSessionID: string | undefined, event: string, body?: any) {
		if (event === "dart.testNotification") {
			void this.handleNotification(debugSessionID, dartCodeDebugSessionID ?? `untagged-session-${debugSessionID}`, body as Notification).catch((e) => this.logger.error(e));
		}
	}

	public handleDebugSessionEnd(debugSessionID: string, dartCodeDebugSessionID: string | undefined) {
		// Get the suite paths that have us as the owning debug session.
		const suitePaths = Object.keys(this.owningDebugSessions).filter((suitePath) => {
			const owningSessionID = this.owningDebugSessions[suitePath];
			return owningSessionID === debugSessionID;
		});

		// End them all and remove from the lookup.
		for (const suitePath of suitePaths) {
			this.handleSuiteEnd(dartCodeDebugSessionID, this.data.suites.getForPath(suitePath)!);
			this.owningDebugSessions[suitePath] = undefined;
			delete this.owningDebugSessions[suitePath];
		}
	}

	public async handleNotification(debugSessionID: string, dartCodeDebugSessionID: string, evt: Notification): Promise<void> {
		switch (evt.type) {
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "start":
			// 	this.handleStartNotification(evt as StartNotification);
			// 	break;
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "allSuites":
			// 	this.handleAllSuitesNotification(evt as AllSuitesNotification);
			// 	break;
			case "suite":
				const event = evt as SuiteNotification;
				// HACK: Handle paths with wrong slashes.
				// https://github.com/Dart-Code/Dart-Code/issues/4441
				if (isWin)
					event.suite.path = normalizeSlashes(event.suite.path);

				this.owningDebugSessions[event.suite.path] = debugSessionID;
				this.handleSuiteNotification(dartCodeDebugSessionID, event);
				break;
			case "testStart":
				this.handleTestStartNotification(dartCodeDebugSessionID, evt as TestStartNotification);
				break;
			case "testDone":
				this.handleTestDoneNotification(dartCodeDebugSessionID, evt as TestDoneNotification);
				break;
			case "group":
				this.handleGroupNotification(dartCodeDebugSessionID, evt as GroupNotification);
				break;
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "done":
			// 	this.handleDoneNotification(suite, evt as DoneNotification);
			// 	break;
			case "print":
				this.handlePrintNotification(dartCodeDebugSessionID, evt as PrintNotification);
				break;
			case "error":
				this.handleErrorNotification(dartCodeDebugSessionID, evt as ErrorNotification);
				break;
		}
	}

	private handleSuiteNotification(dartCodeDebugSessionID: string, evt: SuiteNotification) {
		if (!this.debugSessionLookups[dartCodeDebugSessionID])
			this.debugSessionLookups[dartCodeDebugSessionID] = { suiteForID: {}, suiteForTestID: {} };

		const suiteData = this.data.suiteDiscovered(dartCodeDebugSessionID, evt.suite.path);

		this.debugSessionLookups[dartCodeDebugSessionID].suiteForID[evt.suite.id] = suiteData;

		// Also capture the test nodes from the outline so that we can look up the full range for a test (instead of online its line/col)
		// to provide to VS Code to better support "run test at cursor".
		this.captureTestOutlne(evt.suite.path);
	}

	private captureTestOutlne(path: string) {
		const visitor = new TestOutlineVisitor(this.logger, path);
		this.suiteOutlineVisitors[path] = visitor;
		const outline = this.fileTracker.getOutlineFor(URI.file(path));
		if (outline)
			visitor.visit(outline);
	}

	private handleTestStartNotification(dartCodeDebugSessionID: string, evt: TestStartNotification) {
		// Skip loading tests.
		if (evt.test.name?.startsWith("loading ") && !evt.test.groupIDs?.length)
			return;

		const suite = this.debugSessionLookups[dartCodeDebugSessionID]!.suiteForID[evt.test.suiteID];
		if (!suite) {
			this.logger.warn(`Could not find suite ${evt.test.suiteID} for session ${dartCodeDebugSessionID}`);
			return;
		}
		this.debugSessionLookups[dartCodeDebugSessionID]!.suiteForTestID[evt.test.id] = suite;

		/// We prefer the root location (the location inside the executed test suite) for normal tests, but for
		// setup/tearDown we want to consider them in their actual locations so that failures will be attributed
		// to them correctly.
		// https://github.com/Dart-Code/Dart-Code/issues/4681#issuecomment-1671191742
		const useRootLocation = !isSetupOrTeardownTestName(evt.test.name) && !!evt.test.root_url && !!evt.test.root_line && !!evt.test.root_column;

		const path = maybeUriToFilePath(useRootLocation ? evt.test.root_url : evt.test.url);
		const line = useRootLocation ? evt.test.root_line : evt.test.line;
		const character = useRootLocation ? evt.test.root_column : evt.test.column;

		const range = this.getRangeForNode(suite, line, character);
		const groupID = evt.test.groupIDs?.length ? evt.test.groupIDs[evt.test.groupIDs.length - 1] : undefined;

		this.data.testDiscovered(dartCodeDebugSessionID, suite.path, TestSource.Result, evt.test.id, evt.test.name, this.getRealGroupId(dartCodeDebugSessionID, groupID), path, range, evt.time, true);
	}

	private handleTestDoneNotification(dartCodeDebugSessionID: string, evt: TestDoneNotification) {
		// If we don't have a test, it was likely a "loading foo.dart" test that we skipped over, so skip the result too.
		const suite = this.debugSessionLookups[dartCodeDebugSessionID]?.suiteForTestID[evt.testID];
		if (!suite) {
			return;
		}
		const test = suite.getCurrentTest(dartCodeDebugSessionID, evt.testID);
		if (!test)
			return;

		const result = evt.skipped ? "skipped" : evt.result;
		this.data.testDone(dartCodeDebugSessionID, suite.path, evt.testID, result, evt.time);
	}

	private handleGroupNotification(dartCodeDebugSessionID: string, evt: GroupNotification) {
		// Skip phantom groups.
		if (!evt.group.name) {
			if (dartCodeDebugSessionID) {
				this.phantomGroupParents[dartCodeDebugSessionID] = this.phantomGroupParents[dartCodeDebugSessionID] || {};
				this.phantomGroupParents[dartCodeDebugSessionID][evt.group.id] = evt.group.parentID ?? null; // Null signifies top-level.
			}
			return;
		}

		const suite = this.debugSessionLookups[dartCodeDebugSessionID]?.suiteForID[evt.group.suiteID];
		if (!suite) {
			this.logger.warn(`Could not find suite ${evt.group.suiteID} for session ${dartCodeDebugSessionID}`);
			return;
		}

		const path = (evt.group.root_url || evt.group.url) ? uriToFilePath(evt.group.root_url || evt.group.url!) : undefined;
		const line = evt.group.root_line || evt.group.line;
		const character = evt.group.root_column || evt.group.column;
		const range = this.getRangeForNode(suite, line, character);
		this.data.groupDiscovered(dartCodeDebugSessionID, suite.path, TestSource.Result, evt.group.id, evt.group.name, this.getRealGroupId(dartCodeDebugSessionID, evt.group.parentID), path, range, true);
	}

	private getRealGroupId(dartCodeDebugSessionID: string, groupID: number | undefined) {
		const mapping = dartCodeDebugSessionID ? this.phantomGroupParents[dartCodeDebugSessionID] : undefined;
		const mappedValue = mapping && groupID ? mapping[groupID] : undefined;
		// Null is a special value that means undefined top-level)
		return mappedValue === null
			? undefined
			// Whereas a real undefined we just pass-through as it was.
			: mappedValue ?? groupID;
	}

	private handleSuiteEnd(dartCodeDebugSessionID: string | undefined, suite: SuiteData) {
		this.data.suiteDone(dartCodeDebugSessionID, suite.path);
	}

	private handlePrintNotification(dartCodeDebugSessionID: string, evt: PrintNotification) {
		const suite = this.debugSessionLookups[dartCodeDebugSessionID]?.suiteForTestID[evt.testID];
		if (!suite) {
			this.logger.warn(`Could not find suite for test ${evt.testID} for session ${dartCodeDebugSessionID}`);
			return;
		}

		const test = suite.getCurrentTest(dartCodeDebugSessionID, evt.testID);

		// It's possible we'll get notifications for tests we don't track (like loading tests) - for example package:test
		// may send "Consider enabling the flag chain-stack-traces to receive more detailed exceptions" against the first
		// loading test.
		if (!test)
			return;

		test.outputEvents.push(evt);
		this.data.testOutput(dartCodeDebugSessionID, suite.path, evt.testID, evt.message);
	}

	private handleErrorNotification(dartCodeDebugSessionID: string, evt: ErrorNotification) {
		const suite = this.debugSessionLookups[dartCodeDebugSessionID]?.suiteForTestID[evt.testID];
		if (!suite) {
			this.logger.warn(`Could not find suite for test ${evt.testID} for session ${dartCodeDebugSessionID}`);
			return;
		}

		const test = suite.getCurrentTest(dartCodeDebugSessionID, evt.testID);

		// It's possible we'll get notifications for tests we don't track (like loading tests) - for example package:test
		// may send "Consider enabling the flag chain-stack-traces to receive more detailed exceptions" against the first
		// loading test.
		if (!test)
			return;

		// Flutter emits an error when tests fail which when reported to the VS Code API will result in not-so-useful text
		// in the Test Error Peek window, so we suppress messages that match this pattern.
		const pattern = new RegExp(`
Test failed. See exception logs above.
The test description was: .*
`.trim());
		if (pattern.test(evt.error.trim()))
			return;

		test.outputEvents.push(evt);
		this.data.testErrorOutput(dartCodeDebugSessionID, suite.path, evt.testID, evt.isFailure, evt.error, evt.stackTrace);
	}

	private getRangeForNode(suite: SuiteData, line: number | undefined, character: number | undefined): Range | undefined {
		if (!line || !character)
			return;

		// VS Code is zero-based, but package:test is 1-based.
		const zeroBasedLine = line - 1;
		const zeroBasedCharacter = character - 1;

		// In test notifications, we only get the start line/column but we need to give VS Code the full range for "Run Test at Cursor" to work.
		// The outline data was captured when the suite started, so we can assume it's reasonable accurate, so try to look up the node
		// there and use its range. Otherwise, just make a range that goes from the start position to the next line (assuming the rest
		// of the line is the test name, and we can at least support running it there).
		const testsOnLine = line ? this.suiteOutlineVisitors[suite.path]?.testsByLine[zeroBasedLine] : undefined;
		const test = testsOnLine ? testsOnLine.find((t) => t.range.start.character === zeroBasedCharacter) : undefined;

		const range = line && character
			? test?.range ?? {
				end: { line: zeroBasedLine + 1, character: zeroBasedCharacter },
				start: { line: zeroBasedLine, character: zeroBasedCharacter },
			} as Range
			: undefined;

		return range;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
