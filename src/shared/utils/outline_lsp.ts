import { Range } from "vscode-languageclient";
import { Outline } from "../analysis/lsp/custom_protocol";
import { Logger } from "../interfaces";
import { TestOutlineInfo } from "./outline_das";

export abstract class LspOutlineVisitor {
	constructor(private logger: Logger) { }

	public visit(outline: Outline) {
		this.visitNode(outline);
	}

	private visitChildren(outline: Outline) {
		if (outline.children) {
			for (const child of outline.children) {
				this.visit(child);
			}
		}
	}

	private visitNode(outline: Outline) {
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
				this.logger.error(`Unknown Outline item! ${outline && outline.element && outline.element.kind}`);
		}
	}

	protected visitClass(outline: Outline): void { this.visitChildren(outline); }
	protected visitClassTypeAlias(outline: Outline): void { this.visitChildren(outline); }
	protected visitCompilationUnit(outline: Outline): void { this.visitChildren(outline); }
	protected visitConstructor(outline: Outline): void { this.visitChildren(outline); }
	protected visitContructorInvocation(outline: Outline): void { this.visitChildren(outline); }
	protected visitEnum(outline: Outline): void { this.visitChildren(outline); }
	protected visitEnumConstant(outline: Outline): void { this.visitChildren(outline); }
	protected visitField(outline: Outline): void { this.visitChildren(outline); }
	protected visitXXX(outline: Outline): void { this.visitChildren(outline); }
	protected visitFile(outline: Outline): void { this.visitChildren(outline); }
	protected visitFunctionInvocation(outline: Outline): void { this.visitChildren(outline); }
	protected visitFunctionTypeAlias(outline: Outline): void { this.visitChildren(outline); }
	protected visitGetter(outline: Outline): void { this.visitChildren(outline); }
	protected visitLabel(outline: Outline): void { this.visitChildren(outline); }
	protected visitLibrary(outline: Outline): void { this.visitChildren(outline); }
	protected visitLocalVariable(outline: Outline): void { this.visitChildren(outline); }
	protected visitMethod(outline: Outline): void { this.visitChildren(outline); }
	protected visitParameter(outline: Outline): void { this.visitChildren(outline); }
	protected visitPrefix(outline: Outline): void { this.visitChildren(outline); }
	protected visitSetter(outline: Outline): void { this.visitChildren(outline); }
	protected visitTopLevelVariable(outline: Outline): void { this.visitChildren(outline); }
	protected visitTypeParameter(outline: Outline): void { this.visitChildren(outline); }
	protected visitUnitTestGroup(outline: Outline): void { this.visitChildren(outline); }
	protected visitUnitTestTest(outline: Outline): void { this.visitChildren(outline); }
	protected visitUnknown(outline: Outline): void { this.visitChildren(outline); }
}

export class LspTestOutlineVisitor extends LspOutlineVisitor {
	constructor(logger: Logger, private readonly file: string) {
		super(logger);
	}
	public readonly tests: LspTestOutlineInfo[] = [];
	private readonly names: string[] = [];
	protected visitUnitTestTest(outline: Outline) {
		this.addTest(outline, super.visitUnitTestTest);
	}
	protected visitUnitTestGroup(outline: Outline) {
		this.addTest(outline, super.visitUnitTestGroup);
	}

	private addTest(outline: Outline, base: (outline: Outline) => void) {
		const name = this.extractTestName(outline.element.name);
		if (!name || !outline.element.range)
			return;
		this.names.push(name);
		const fullName = this.names.join(" ");
		const isGroup = outline.element.kind === "UNIT_TEST_GROUP";
		this.tests.push({
			file: this.file,
			fullName,
			isGroup,
			range: outline.codeRange || outline.range || (outline.element ? outline.element.range : undefined),
		});
		try {
			base.bind(this)(outline);
		} finally {
			this.names.pop();
		}
	}

	private extractTestName(elementName: string): string | undefined {
		if (!elementName)
			return;
		// Strip off the function name/parent like test( or testWidget(
		const openParen = elementName.indexOf("(");
		const closeParen = elementName.lastIndexOf(")");
		if (openParen === -1 || closeParen === -1 || openParen >= closeParen)
			return;

		elementName = elementName
			.substring(openParen + 2, closeParen - 1);

		return elementName;
	}
}

export interface LspTestOutlineInfo extends TestOutlineInfo {
	range: Range;
}
