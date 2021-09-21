// TODO: Move this to Shared (and remove dependencies on extension/)

import { Outline, OutlineParams } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable, Logger } from "../../shared/interfaces";
import { TestModel, TestSource } from "../../shared/test/test_model";
import { disposeAll, uriToFilePath } from "../../shared/utils";
import { forceWindowsDriveLetterToUppercase } from "../../shared/utils/fs";
import { LspOutlineVisitor } from "../../shared/utils/outline_lsp";
import { extractTestNameFromOutline } from "../../shared/utils/test";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { isTestFile } from "../utils";

export class TestDiscoverer implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(private readonly logger: Logger, fileTracker: LspFileTracker, private readonly model: TestModel) {
		this.disposables.push(fileTracker.onOutline.listen((o) => this.handleOutline(o)));
	}

	private handleOutline(outline: OutlineParams) {
		const suitePath = forceWindowsDriveLetterToUppercase(uriToFilePath(outline.uri));
		if (isTestFile(suitePath)) {
			// Force creation of a node.
			const [suite, didCreate] = this.model.getOrCreateSuite(suitePath);
			const stack: Array<{ id: number, name: string }> = [];
			const model = this.model;

			let id = 1;

			model.flagNewDiscovery(suite);
			// Mark everything in the suite as potentially-deleted so that we can detect anything
			// that was not present in the new list to remove it afterwards.
			model.markAllAsPotentiallyDeleted(suite, TestSource.Outline);

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

					const range = outline.codeRange || outline.range || (outline.element ? outline.element.range : undefined);
					const parent = stack.length > 0 ? stack[stack.length - 1] : undefined;

					const fullName = parent?.name
						? `${parent.name} ${name}`
						: name;

					const thisID = id++;
					if (isGroup)
						model.groupDiscovered(undefined, suitePath, TestSource.Outline, thisID, fullName, parent?.id, undefined, range);
					else
						model.testDiscovered(undefined, suitePath, TestSource.Outline, thisID, fullName, parent?.id, undefined, range, undefined);

					if (isGroup)
						stack.push({ id: thisID, name: fullName });
					try {
						base.bind(this)(outline);
					} finally {
						if (isGroup)
							stack.pop();
					}
				}
			}(this.logger);
			visitor.visit(outline.outline);

			model.removeAllPotentiallyDeletedNodes(suite);

			this.model.updateNode();
		}
	}

	public dispose(): any {
		disposeAll(this.disposables);
	}
}
