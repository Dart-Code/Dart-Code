import * as as from "../analysis_server_types";
import { Logger } from "../interfaces";

export abstract class FlutterOutlineVisitor {
	constructor(private logger: Logger) { }

	public visit(outline: as.FlutterOutline) {
		this.visitNode(outline);
	}

	private visitChildren(outline: as.FlutterOutline) {
		if (outline.children) {
			for (const child of outline.children) {
				this.visit(child);
			}
		}
	}

	private visitNode(outline: as.FlutterOutline) {
		switch (outline && outline.kind) {
			case "DART_ELEMENT":
				this.visitDartElement(outline);
				break;
			case "GENERIC":
				this.visitGeneric(outline);
				break;
			case "NEW_INSTANCE":
				this.visitNewInstance(outline);
				break;
			case "INVOCATION":
				this.visitInvocation(outline);
				break;
			case "VARIABLE":
				this.visitVariable(outline);
				break;
			case "PLACEHOLDER":
				this.visitPlaceholder(outline);
				break;
			default:
				this.logger.error(`Unknown Flutter Outline item! ${outline && outline.kind}`);
		}
		if (outline.attributes) {
			for (const attribute of outline.attributes)
				this.visitAttribute(attribute);
		}
	}

	protected visitDartElement(outline: as.FlutterOutline): void { this.visitChildren(outline); }
	protected visitGeneric(outline: as.FlutterOutline): void { this.visitChildren(outline); }
	protected visitNewInstance(outline: as.FlutterOutline): void { this.visitChildren(outline); }
	protected visitInvocation(outline: as.FlutterOutline): void { this.visitChildren(outline); }
	protected visitVariable(outline: as.FlutterOutline): void { this.visitChildren(outline); }
	protected visitPlaceholder(outline: as.FlutterOutline): void { this.visitChildren(outline); }
	// tslint:disable-next-line: no-empty
	protected visitAttribute(attribute: as.FlutterOutlineAttribute): void { }
}
