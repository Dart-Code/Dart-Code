import { FlutterOutline } from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { fsPath } from "../../shared/utils/fs";
import { IconRangeComputer } from "../../shared/vscode/icon_range_computer";
import { DasAnalyzer } from "../analysis/analyzer_das";
import { FlutterIconDecorations } from "./flutter_icon_decorations";

export class FlutterIconDecorationsDas extends FlutterIconDecorations {
	private readonly computer: IconRangeComputer;
	constructor(logger: Logger, private readonly analyzer: DasAnalyzer) {
		super(logger);
		this.computer = new IconRangeComputer(logger);

		this.subscriptions.push(this.analyzer.client.registerForFlutterOutline(async (n) => {
			if (this.activeEditor && fsPath(this.activeEditor.document.uri) === n.file) {
				this.update(n.outline);
			}
		}));
	}

	protected update(outline?: FlutterOutline) {
		if (!this.activeEditor)
			return;

		if (!outline)
			outline = this.analyzer.fileTracker.getFlutterOutlineFor(this.activeEditor.document.uri);

		if (!outline)
			return;

		const results = this.computer.compute(this.activeEditor.document, outline);

		this.render(results);
	}
}
