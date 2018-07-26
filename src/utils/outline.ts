import * as vs from "vscode";
import * as as from "../analysis/analysis_server_types";
import { OpenFileTracker } from "../analysis/open_file_tracker";
import { logError } from "./log";

function findNode(outlines: as.Outline[], offset: number, useReducedRange: boolean, kinds: as.ElementKind[]): as.Outline | undefined {
	if (!outlines)
		return null;
	for (const outline of outlines) {
		const outlineStart = outline.offset;
		const outlineEnd = outline.offset + outline.length;

		// Bail if this node is not spanning us.
		if (outlineStart > offset || outlineEnd < offset)
			continue;

		// Although we use the full code range above so that we can walk into children, when performing a match we want to stop
		// at the end of the element, so we use a reduce range to avoid returning a method for the whole of its body.
		const isInReducedRange = !useReducedRange || !outline.element || !outline.element.location
			|| (offset >= outlineStart && offset <= outline.element.location.offset + outline.element.location.length);

		return findNode(outline.children, offset, useReducedRange, kinds)
			|| (kinds.indexOf(outline.element.kind) !== -1 && isInReducedRange ? outline : null);
	}
}

export function findNearestOutlineNode(document: vs.TextDocument, position: vs.Position, useReducedRange = false, kinds: as.ElementKind[] = ["CLASS", "METHOD", "GETTER", "SETTER"]) {
	const outline = OpenFileTracker.getOutlineFor(document.uri);
	return outline && findNode([outline], document.offsetAt(position), useReducedRange, kinds);
}

export abstract class OutlineVisitor {
	public visit(outline: as.Outline) {
		this.visitNode(outline);
	}

	private visitChildren(outline: as.Outline) {
		if (outline.children) {
			for (const child of outline.children) {
				this.visit(child);
			}
		}
	}

	private visitNode(outline: as.Outline) {
		switch (outline && outline.element && outline.element.kind) {
			case "CLASS":
				this.visitClass(outline);
				break;
			case "CLASS_TYPE_ALIAS":
				this.visitClassTypeAlias(outline);
				break;
			case "COMPILATION_UNIT":
				this.visitCompilationUnit(outline);
				break;
			case "CONSTRUCTOR":
				this.visitConstructor(outline);
				break;
			case "CONSTRUCTOR_INVOCATION":
				this.visitContructorInvocation(outline);
				break;
			case "ENUM":
				this.visitEnum(outline);
				break;
			case "ENUM_CONSTANT":
				this.visitEnumConstant(outline);
				break;
			case "FIELD":
				this.visitField(outline);
				break;
			case "FILE":
				this.visitXXX(outline);
				break;
			case "FUNCTION":
				this.visitFile(outline);
				break;
			case "FUNCTION_INVOCATION":
				this.visitFunctionInvocation(outline);
				break;
			case "FUNCTION_TYPE_ALIAS":
				this.visitFunctionTypeAlias(outline);
				break;
			case "GETTER":
				this.visitGetter(outline);
				break;
			case "LABEL":
				this.visitLabel(outline);
				break;
			case "LIBRARY":
				this.visitLibrary(outline);
				break;
			case "LOCAL_VARIABLE":
				this.visitLocalVariable(outline);
				break;
			case "METHOD":
				this.visitMethod(outline);
				break;
			case "PARAMETER":
				this.visitParameter(outline);
				break;
			case "PREFIX":
				this.visitPrefix(outline);
				break;
			case "SETTER":
				this.visitSetter(outline);
				break;
			case "TOP_LEVEL_VARIABLE":
				this.visitTopLevelVariable(outline);
				break;
			case "TYPE_PARAMETER":
				this.visitTypeParameter(outline);
				break;
			case "UNIT_TEST_GROUP":
				this.visitUnitTestGroup(outline);
				break;
			case "UNIT_TEST_TEST":
				this.visitUnitTestTest(outline);
				break;
			case "UNKNOWN":
				this.visitUnknown(outline);
				break;
			default:
				logError(`Unknown Outline item! ${outline && outline.element && outline.element.kind}`);
		}
	}

	protected visitClass(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitClassTypeAlias(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitCompilationUnit(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitConstructor(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitContructorInvocation(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitEnum(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitEnumConstant(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitField(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitXXX(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitFile(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitFunctionInvocation(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitFunctionTypeAlias(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitGetter(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitLabel(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitLibrary(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitLocalVariable(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitMethod(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitParameter(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitPrefix(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitSetter(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitTopLevelVariable(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitTypeParameter(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitUnitTestGroup(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitUnitTestTest(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitUnknown(outline: as.Outline): void { this.visitChildren(outline); }
}
