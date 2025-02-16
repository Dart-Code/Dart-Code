import { FlutterOutline, FlutterOutlineAttribute } from "../analysis/lsp/custom_protocol";
import { Logger } from "../interfaces";

export abstract class FlutterOutlineVisitor {
	constructor(private logger: Logger) { }

	public visit(outline: FlutterOutline) {
		this.visitNode(outline);
	}

	private visitChildren(outline: FlutterOutline) {
		if (outline.children) {
			for (const child of outline.children) {
				this.visit(child);
			}
		}
	}

	private visitNode(outline: FlutterOutline) {
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

	protected visitDartElement(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitGeneric(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitNewInstance(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitInvocation(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitVariable(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitPlaceholder(outline: FlutterOutline): void { this.visitChildren(outline); }
	// tslint:disable-next-line: no-empty
	protected visitAttribute(attribute: FlutterOutlineAttribute): void { }
}

export abstract class FlutterOutlineVisitorLsp {
	constructor(private logger: Logger) { }

	public visit(outline: FlutterOutline) {
		this.visitNode(outline);
	}

	private visitChildren(outline: FlutterOutline) {
		if (outline.children) {
			for (const child of outline.children) {
				this.visit(child);
			}
		}
	}

	private visitNode(outline: FlutterOutline) {
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

	protected visitDartElement(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitGeneric(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitNewInstance(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitInvocation(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitVariable(outline: FlutterOutline): void { this.visitChildren(outline); }
	protected visitPlaceholder(outline: FlutterOutline): void { this.visitChildren(outline); }
	// tslint:disable-next-line: no-empty
	protected visitAttribute(attribute: FlutterOutlineAttribute): void { }
}
