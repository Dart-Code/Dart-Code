import { DebugSessionWithDartCodeSessionId } from "../../shared/debug/interfaces";
import { IAmDisposable, Logger } from "../interfaces";
import { ErrorNotification, GroupNotification, Notification, PrintNotification, SuiteNotification, TestDoneNotification, TestStartNotification } from "../test_protocol";
import { disposeAll, uriToFilePath } from "../utils";
import { SuiteData, TestModel } from "./test_model";

/// Handles results from a test debug session and provides them to the test model.
export class TestSessionCoordinator implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	/// A link between a suite path and the debug session ID that owns it.
	private owningDebugSessions: { [key: string]: string | undefined } = {};

	constructor(private readonly logger: Logger, private readonly data: TestModel) { }

	public handleDebugSessionCustomEvent(e: { session: { id: string }; event: string; body?: any }) {
		const session = e.session as DebugSessionWithDartCodeSessionId;
		if (e.event === "dart.testRunNotification") {
			// tslint:disable-next-line: no-floating-promises
			this.handleNotification(session.id, session.configuration.dartCodeDebugSessionID, e.body.suitePath, e.body.notification).catch((e) => this.logger.error(e));
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
	}

	private handleTestStartNotifcation(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: TestStartNotification) {
		const path = (evt.test.root_url || evt.test.url) ? uriToFilePath(evt.test.root_url || evt.test.url!) : undefined;
		const line = evt.test.root_line || evt.test.line;
		const column = evt.test.root_column || evt.test.column;
		this.data.testStarted(dartCodeDebugSessionID, suite.path, evt.test.id, evt.test.name, evt.test.groupIDs, path, line, column, evt.time);
	}

	private handleTestDoneNotification(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: TestDoneNotification) {
		const result = evt.skipped ? "skipped" : evt.result;
		this.data.testDone(dartCodeDebugSessionID, suite.path, evt.testID, result, evt.hidden, evt.time);
	}

	private handleGroupNotification(dartCodeDebugSessionID: string | undefined, suite: SuiteData, evt: GroupNotification) {
		const path = (evt.group.root_url || evt.group.url) ? uriToFilePath(evt.group.root_url || evt.group.url!) : undefined;
		const line = evt.group.root_line || evt.group.line;
		const column = evt.group.root_column || evt.group.column;
		this.data.groupDiscovered(dartCodeDebugSessionID, suite.path, evt.group.id, evt.group.name, evt.group.parentID, path, line, column);
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

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
