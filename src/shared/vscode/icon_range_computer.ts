import * as vs from "vscode";
import * as lsc from "vscode-languageclient";
import { Logger } from "../../shared/interfaces";
import { FlutterOutlineVisitorLsp } from "../../shared/utils/flutter_outline";
import * as lsp from "../analysis/lsp/custom_protocol";
import { lspToRange } from "./utils";

export class IconRangeComputerLsp {
	constructor(private readonly logger: Logger) { }

	public compute(outline: lsp.FlutterOutline): Record<string, vs.Range[]> {
		const iconVisitor = new FlutterOutlineIconVisitorLsp(this.logger);
		iconVisitor.visit(outline);

		// Now build a map of all possible decorations, with those in this file. We need to include all
		// icons so if any were removed, we will clear their decorations.
		const decs: Record<string, vs.Range[]> = {};
		iconVisitor.icons.forEach((icon) => {
			const iconFile = `${icon.type}/${icon.iconName}`;
			if (!decs[iconFile])
				decs[iconFile] = [];

			decs[iconFile].push(lspToRange(icon.range));
		});

		return decs;
	}
}

class FlutterOutlineIconVisitorLsp extends FlutterOutlineVisitorLsp {
	public readonly icons: Array<{ range: lsc.Range, type: "material" | "cupertino", iconName: string }> = [];
	private readonly materialIconValuePattern = new RegExp("^Icons\\.([\\w_]+)$");
	private readonly cupertinoIconValuePattern = new RegExp("^CupertinoIcons\\.([\\w_]+)$");

	protected visitAttribute(attribute: lsp.FlutterOutlineAttribute) {
		if (attribute.label && attribute.valueRange) {
			let match = this.materialIconValuePattern.exec(attribute.label);
			if (match)
				this.icons.push({ iconName: match[1], range: attribute.valueRange, type: "material" });
			match = this.cupertinoIconValuePattern.exec(attribute.label);
			if (match)
				this.icons.push({ iconName: match[1], range: attribute.valueRange, type: "cupertino" });
		}
	}
}
