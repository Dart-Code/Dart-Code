import * as as from "../analysis_server_types";
import { Logger } from "../interfaces";
import { extractTestNameFromOutline } from "./test";

export abstract class OutlineVisitor {
	constructor(private logger: Logger) { }

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
		switch (outline?.element?.kind) {
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
				this.visitFile(outline);
				break;
			case "FUNCTION":
				this.visitFunction(outline);
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
			case "MIXIN":
				this.visitMixin(outline);
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
				this.logger.error(`Unknown Outline item! ${outline?.element?.kind} (${outline?.element?.name})`);
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
	protected visitFile(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitFunction(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitFunctionInvocation(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitFunctionTypeAlias(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitGetter(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitLabel(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitLibrary(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitLocalVariable(outline: as.Outline): void { this.visitChildren(outline); }
	protected visitMixin(outline: as.Outline): void { this.visitChildren(outline); }
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

export class TestOutlineVisitor extends OutlineVisitor {
	public readonly tests: DasTestOutlineInfo[] = [];
	private readonly names: string[] = [];
	protected visitUnitTestTest(outline: as.Outline) {
		this.addTest(outline, super.visitUnitTestTest);
	}
	protected visitUnitTestGroup(outline: as.Outline) {
		this.addTest(outline, super.visitUnitTestGroup);
	}

	private addTest(outline: as.Outline, base: (outline: as.Outline) => void) {
		const name = extractTestNameFromOutline(outline.element.name);
		if (!name || !outline.element.location)
			return;
		this.names.push(name);
		const fullName = this.names.join(" ");
		const isGroup = outline.element.kind === "UNIT_TEST_GROUP";
		this.tests.push({
			file: outline.element.location.file,
			fullName,
			isGroup,
			length: outline.codeLength || outline.element.location.length,
			offset: outline.codeOffset || outline.element.location.offset,
		});
		try {
			base.bind(this)(outline);
		} finally {
			this.names.pop();
		}
	}
}

export interface TestOutlineInfo {
	fullName: string;
	file: string;
	isGroup: boolean;
}

export interface DasTestOutlineInfo extends TestOutlineInfo {
	offset: number;
	length: number;
}

export class ClassOutlineVisitor extends OutlineVisitor {
	public readonly classes: ClassInfo[] = [];
	protected visitClass(outline: as.Outline) {
		this.addClass(outline);
		super.visitClass(outline);
	}

	protected visitMixin(outline: as.Outline) {
		this.addClass(outline);
		super.visitMixin(outline);
	}

	private addClass(outline: as.Outline) {
		if (!outline.element || !outline.element.location || !outline.element.name)
			return;
		this.classes.push({
			className: outline.element.name,
			codeLength: outline.codeLength,
			codeOffset: outline.codeOffset,
			length: outline.length,
			offset: outline.offset,
		});
	}
}

export interface ClassInfo {
	className: string;
	offset: number;
	length: number;
	codeOffset: number;
	codeLength: number;
}
