import * as _ from "lodash";
import { CancellationToken, CodeLens, CodeLensProvider, commands, debug, Event, EventEmitter, TextDocument, Uri, workspace } from "vscode";
import { Outline } from "../analysis/analysis_server_types";
import { Analyzer } from "../analysis/analyzer";
import { OpenFileTracker } from "../analysis/open_file_tracker";
import { IAmDisposable } from "../debug/utils";
import { toRange } from "../utils";
import { OutlineVisitor } from "../utils/outline";
import { getLaunchConfig } from "../utils/test";

export class TestCodeLensProvider implements CodeLensProvider, IAmDisposable {
	private disposables: IAmDisposable[] = [];
	private onDidChangeCodeLensesEmitter: EventEmitter<void> = new EventEmitter<void>();
	public readonly onDidChangeCodeLenses: Event<void> = this.onDidChangeCodeLensesEmitter.event;

	constructor(public readonly analyzer: Analyzer) {
		this.disposables.push(this.analyzer.registerForAnalysisOutline((n) => {
			this.onDidChangeCodeLensesEmitter.fire();
		}));

		this.disposables.push(commands.registerCommand("_dart.startDebuggingTestFromOutline", (test: Test) => {
			debug.startDebugging(
				workspace.getWorkspaceFolder(Uri.file(test.file)),
				getLaunchConfig(false, test.file, test.fullName, test.isGroup),
			);
		}));
		this.disposables.push(commands.registerCommand("_dart.startWithoutDebuggingTestFromOutline", (test: Test) => {
			debug.startDebugging(
				workspace.getWorkspaceFolder(Uri.file(test.file)),
				getLaunchConfig(true, test.file, test.fullName, test.isGroup),
			);
		}));
	}

	public async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
		// This method has to be FAST because it affects layout of the document (adds extra lines) so
		// we don't already have an outline, we won't wait for one. A new outline arriving will trigger a
		// re-requesrt anyway.
		const outline = OpenFileTracker.getOutlineFor(document.uri);
		if (!outline || !outline.children || !outline.children.length)
			return;

		const visitor = new TestOutlineVisitor();
		visitor.visit(outline);
		return _.flatMap(
			visitor.tests
				.filter((test) => test.offset && test.length)
				.map((test) => {
					return [
						new CodeLens(
							toRange(document, test.offset, test.length),
							{
								arguments: [test],
								command: "_dart.startWithoutDebuggingTestFromOutline",
								title: "Run",
							},
						),
						new CodeLens(
							toRange(document, test.offset, test.length),
							{
								arguments: [test],
								command: "_dart.startDebuggingTestFromOutline",
								title: "Debug",
							},
						),
					];
				}),
		);
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}

class TestOutlineVisitor extends OutlineVisitor {
	public readonly tests: Test[] = [];
	private readonly names: string[] = [];
	protected visitUnitTestTest(outline: Outline) {
		this.addTest(outline, super.visitUnitTestTest);
	}
	protected visitUnitTestGroup(outline: Outline) {
		this.addTest(outline, super.visitUnitTestGroup);
	}

	private addTest(outline: Outline, base: (outline: Outline) => void) {
		const name = this.extractTestName(outline.element.name);
		if (!name)
			return;
		this.names.push(name);
		const fullName = this.names.join(" ");
		const isGroup = outline.element.kind === "UNIT_TEST_GROUP";
		this.tests.push({
			file: outline.element.location.file,
			fullName,
			isGroup,
			length: outline.element.location.length,
			offset: outline.element.location.offset,
		});
		try {
			base.bind(this)(outline);
		} finally {
			this.names.pop();
		}
	}

	private extractTestName(elementName: string): string | undefined {
		if (!elementName)
			return;
		// Strip off the function name/parent like test( or testWidget(
		const openParen = elementName.indexOf("(");
		const closeParen = elementName.lastIndexOf(")");
		if (openParen === -1 || closeParen === -1 || openParen > closeParen)
			return;
		elementName = elementName.substring(openParen + 1, closeParen);

		// To avoid implemented Dart string parsing here (escaping, triple quotes, etc.)
		// we will just require that a string is quoted at each end with the same character
		// and contains zero of that character inside the string, and zero backslashes.
		const quoteCharacter = elementName.substr(0, 1);
		if (elementName.slice(-1) !== quoteCharacter)
			return;
		elementName = elementName.slice(1, -1);
		if (elementName.indexOf(quoteCharacter) !== -1 || elementName.indexOf("\\") !== -1)
			return;

		return elementName;
	}
}

interface Test {
	fullName: string;
	file: string;
	offset: number;
	length: number;
	isGroup: boolean;
}
