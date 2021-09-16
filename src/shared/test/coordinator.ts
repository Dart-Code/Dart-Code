import { Outline } from "../analysis/lsp/custom_protocol";
import { IAmDisposable, Logger, Range } from "../interfaces";
import { ErrorNotification, GroupNotification, Notification, PrintNotification, SuiteNotification, TestDoneNotification, TestStartNotification } from "../test_protocol";
import { disposeAll, uriToFilePath } from "../utils";
import { LspTestOutlineVisitor } from "../utils/outline_lsp";
import { SuiteData, TestModel } from "./test_model";

/// Handles results from a test debug session and provides them to the test model.
export class TestSessionCoordinator implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	/// A link between a suite path and the debug session ID that owns it.
	private owningDebugSessions: { [key: string]: string | undefined } = {};

	/// A link between a suite path and a visitor for visiting its latest outline data.
	/// This data is refreshed when a test suite starts running.
	private suiteOutlineVisitors: { [key: string]: LspTestOutlineVisitor | undefined } = {};

	constructor(private readonly logger: Logger, private readonly data: TestModel, private readonly fileTracker: { getOutlineFor(file: { fsPath: string } | string): Outline | undefined } | undefined) { }

	public handleDebugSessionCustomEvent(debugSessionID: string, dartCodeDebugSessionID: string | undefined, event: string, body?: any) {
		if (event === "dart.testRunNotification") {
			// tslint:disable-next-line: no-floating-promises
			this.handleNotification(debugSessionID, dartCodeDebugSessionID, body.suitePath, body.notification).catch((e) => this.logger.error(e));
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
			this.handleSuiteEnd(dartCodeDebugSessionID, this.data.suites[suitePath]);
			this.owningDebugSessions[suitePath] = undefined;
			delete this.owningDebugSessions[suitePath];
		}
	}

	public async handleNotification(debugSessionID: string, dartCodeDebugSessionID: string | undefined, suitePath: string, evt: Notification): Promise<void> {
		// If we're starting a suite, record us as the owner so we can clean up later
		if (evt.type === "suite")
			this.owningDebugSessions[suitePath] = debugSessionID;

		const suite = this.data.suites[suitePath];
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
				this.handleSuiteNotification(dartCodeDebugSessionID, suitePath, evt as SuiteNotification);
				break;
			case "testStart":
				this.handleTestStartNotifcation(dartCodeDebugSessionID, suite, evt as TestStartNotification);
				break;
			case "testDone":
				this.handleTestDoneNotification(dartCodeDebugSessionID, suite, evt as TestDoneNotification);
				break;
			case "group":
				this.handleGroupNotification(dartCodeDebugSessionID, suite, evt as GroupNotification);
				break;
			// We won't get notifications that aren't directly tied to Suites because
			// of how the DA works.
			// case "done":
			// 	this.handleDoneNotification(suite, evt as DoneNotification);
			// 	break;
			case "print":
				this.handlePrintNotification(dartCodeDebugSessionID, suite, evt as PrintNotification);
				break;
			case "error":
				this.handleErrorNotification(dartCodeDebugSessionID, suite, evt as ErrorNotification);
				break;
		}
	}

	private handleSuiteNotification(dartCodeDebugSessionID: string | undefined, suitePath: string, evt: SuiteNotification) {
		this.data.suiteDiscovered(dartCodeDebugSessionID, evt.suite.path);

		// Also capture the test nodes from the outline so that we can look up the full range for a test (instead of online its line/col)
		// to provide to VS Code to better support "run test at cursor".
		this.captureTestOutlne(evt.suite.path);
	}

	private captureTestOutlne(path: string) {
		const visitor = new LspTestOutlineVisitor(this.logger, path);
		this.suiteOutlineVisitors[path] = visitor;
		const outline = this.fileTracker?.getOutlineFor(path);
		if (outline)
			visitor.visit(outline);
	}

	private handleTestStartNotifcation(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: TestStartNotification) {
		const path = (evt.test.root_url || evt.test.url) ? uriToFilePath(evt.test.root_url || evt.test.url!) : undefined;
		const line = evt.test.root_line || evt.test.line;
		const character = evt.test.root_column || evt.test.column;

		const range = this.getRangeForNode(suite, line, character);

		this.data.testStarted(dartCodeDebugSessionID, suite.path, evt.test.id, evt.test.name, evt.test.groupIDs, path, range, evt.time);
	}

	private handleTestDoneNotification(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: TestDoneNotification) {
		const result = evt.skipped ? "skipped" : evt.result;
		this.data.testDone(dartCodeDebugSessionID, suite.path, evt.testID, result, evt.hidden, evt.time);
	}

	private handleGroupNotification(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: GroupNotification) {
		const path = (evt.group.root_url || evt.group.url) ? uriToFilePath(evt.group.root_url || evt.group.url!) : undefined;
		const line = evt.group.root_line || evt.group.line;
		const character = evt.group.root_column || evt.group.column;
		const range = this.getRangeForNode(suite, line, character);
		this.data.groupDiscovered(dartCodeDebugSessionID, suite.path, evt.group.id, evt.group.name, evt.group.parentID, path, range);
	}

	private handleSuiteEnd(dartCodeDebugSessionID: string | undefined, suite: SuiteData) {
		this.data.suiteDone(dartCodeDebugSessionID, suite.path);
	}

	private handlePrintNotification(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: PrintNotification) {
		const test = suite.getCurrentTest(evt.testID);
		test.outputEvents.push(evt);
		this.data.testOutput(dartCodeDebugSessionID, suite.path, evt.testID, evt.message);
	}

	private handleErrorNotification(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: ErrorNotification) {
		const test = suite.getCurrentTest(evt.testID);
		test.outputEvents.push(evt);
		this.data.testErrorOutput(dartCodeDebugSessionID, suite.path, evt.testID, evt.isFailure, evt.error, evt.stackTrace);
	}

	private getRangeForNode(suite: SuiteData, line: number | undefined, character: number | undefined): Range | undefined {
		if (!line || !character)
			return;

		// In test notifications, we only get the start line/column but we need to give VS Code the full range for "Run Test at Cursor" to work.
		// The outline data was captured when the suite started, so we can assume it's reasonable accurate, so try to look up the node
		// there and use its range. Otherwise, just make a range that goes from the start position to the next line (assuming the rest
		// of the line is the test name, and we can at least support running it there).
		const testsOnLine = line ? this.suiteOutlineVisitors[suite.path]?.testsByLine[line - 1] : undefined;
		const test = testsOnLine ? testsOnLine.find((t) => t.range.start.character === character - 1) : undefined;

		const range = line && character ? test?.range ?? { start: { line, character }, end: { line: line + 1, character } } : undefined;
		return range;
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
