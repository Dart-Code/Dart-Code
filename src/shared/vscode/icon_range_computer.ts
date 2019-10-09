import * as vs from "vscode";
import { FlutterOutline } from "../../shared/analysis_server_types";
import { Logger } from "../../shared/interfaces";
import { FlutterOutlineIconVisitor } from "../../shared/utils/flutter_outline";
import { toRange } from "./utils";

export class IconRangeComputer {
	constructor(private readonly logger: Logger) { }

	public compute(document: vs.TextDocument, outline: FlutterOutline): { [key: string]: vs.Range[] } | undefined {
		const iconVisitor = new FlutterOutlineIconVisitor(this.logger);
		iconVisitor.visit(outline);

		// Now build a map of all possible decorations, with those in this file. We need to include all
		// icons so if any were removed, we will clear their decorations.
		const decs: { [key: string]: vs.Range[] } = {};
		iconVisitor.icons.forEach((icon) => {
			if (!decs[icon.iconName])
				decs[icon.iconName] = [];

			decs[icon.iconName].push(toRange(document, icon.offset, icon.length));
		});

		return decs;
	}
}
