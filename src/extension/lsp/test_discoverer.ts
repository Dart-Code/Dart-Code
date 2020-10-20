// TODO: Move this to Shared (and remove dependencies on extension/)

import { Outline, OutlineParams } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { GroupNode, SuiteNode, TestNode, TestTreeModel } from "../../shared/test/test_model";
import { uriToFilePath } from "../../shared/utils";
import { LspOutlineVisitor } from "../../shared/utils/outline_lsp";
import { extractTestNameFromOutline, isSimpleTestName } from "../../shared/utils/test";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { isTestFile } from "../utils";

export class TestDiscoverer implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, fileTracker: LspFileTracker, private readonly model: TestTreeModel) {
		this.disposables.push(fileTracker.onOutline.listen((o) => this.handleOutline(o)));
	}

	private handleOutline(outline: OutlineParams) {
		const suitePath = uriToFilePath(outline.uri);
		if (isTestFile(suitePath)) {
			// Force creation of a node.
			const [suite, didCreate] = this.model.getOrCreateSuite(suitePath);

			if (didCreate) {
				const stack: Array<SuiteNode | GroupNode> = [suite.node];
				let id = 1;

				const visitor = new class extends LspOutlineVisitor {
					protected visitUnitTestTest(outline: Outline) {
						this.handleItem(outline, false, super.visitUnitTestTest);
					}
					protected visitUnitTestGroup(outline: Outline) {
						this.handleItem(outline, true, super.visitUnitTestGroup);
					}

					private handleItem(outline: Outline, isGroup: boolean, base: (outline: Outline) => void) {
						const name = extractTestNameFromOutline(outline.element.name);
						if (!name || !outline.element.range)
							return;

						if (!isSimpleTestName(name))
							return;

						const range = outline.codeRange || outline.range || (outline.element ? outline.element.range : undefined);
						const parent = stack[stack.length - 1];
						const fullName = parent instanceof GroupNode && parent.name
							? `${parent.name} ${name}`
							: name;
						const item = isGroup
							? new GroupNode(suite, parent, id++, fullName, suitePath, range.start.line + 1, range.start.character)
							: new TestNode(suite, parent, id++, fullName, suitePath, range.start.line + 1, range.start.character);

						if (item instanceof GroupNode) {
							suite.storeGroup(item);
							parent.groups.push(item);
						} else {
							suite.storeTest(item);
							parent.tests.push(item);
						}

						if (item instanceof GroupNode)
							stack.push(item);
						try {
							base.bind(this)(outline);
						} finally {
							if (item instanceof GroupNode)
								stack.pop();
						}
					}
				}(this.logger);
				visitor.visit(outline.outline);
			}

			this.model.updateNode(suite.node);
			this.model.updateNode();
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
