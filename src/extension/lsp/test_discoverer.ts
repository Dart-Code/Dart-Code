// TODO: Move this to Shared (and remove dependencies on extension/)

import { OutlineParams } from "../../shared/analysis/lsp/custom_protocol";
import { IAmDisposable } from "../../shared/interfaces";
import { TestTreeModel } from "../../shared/test/test_model";
import { uriToFilePath } from "../../shared/utils";
import { LspFileTracker } from "../analysis/file_tracker_lsp";
import { isTestFile } from "../utils";

export class TestDiscoverer implements IAmDisposable {
	private disposables: IAmDisposable[] = [];

	constructor(fileTracker: LspFileTracker, private readonly model: TestTreeModel) {
		this.disposables.push(fileTracker.onOutline.listen((o) => this.handleOutline(o)));
	}

	private handleOutline(outline: OutlineParams) {
		const suitePath = uriToFilePath(outline.uri);
		if (isTestFile(suitePath)) {
			// Force creation of a node.
			const [suite, didCreate] = this.model.getOrCreateSuite(suitePath);

			if (didCreate) {
				// TODO: Create a heirarchical visitor to create groups/tests
				// and add them similar to findOrCreateSuite above.
				// const visitor = new LspTestOutlineVisitor(this.logger, suitePath);
				// visitor.visit(outline.outline);

				// for (const test of visitor.tests) {
				// 	test.
				// }
			}

			this.model.updateNode(suite.node);
			this.model.updateNode();
		}
	}

	public dispose(): any {
		this.disposables.forEach((d) => d.dispose());
	}
}
