import * as path from "path";
import * as vs from "vscode";
import * as lsp from "vscode-languageclient";
import { FlutterOutline } from "../../shared/analysis/lsp/custom_protocol";
import { LogCategory } from "../../shared/enums";
import { Logger } from "../../shared/interfaces";
import { nullLogger } from "../../shared/logging";
import { disposeAll } from "../../shared/utils";
import { fsPath } from "../../shared/utils/fs";
import { extensionPath } from "../../shared/vscode/extension_utils";
import { getIconForSymbolKind } from "../../shared/vscode/mappings";
import { lspToPosition, lspToRange, toRange, treeLabel } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer";
import { flutterOutlineCommands } from "../commands/flutter_outline";
import { isAnalyzable } from "../utils";

const DART_SHOW_FLUTTER_OUTLINE = "dart-code:showFlutterOutline";
const WIDGET_SELECTED_CONTEXT = "dart-code:isSelectedWidget";
const WIDGET_SUPPORTS_CONTEXT_PREFIX = "dart-code:widgetSupports:";

export class FlutterOutlineProvider implements vs.TreeDataProvider<FlutterWidgetItem>, vs.Disposable {
	protected subscriptions: vs.Disposable[] = [];
	protected activeEditor: vs.TextEditor | undefined;
	protected flutterOutline: FlutterOutline | undefined;
	protected rootNode: FlutterWidgetItem | undefined;
	protected treeNodesByLine: Record<number, FlutterWidgetItem[]> = [];
	protected updateTimeout: NodeJS.Timeout | undefined;
	protected onDidChangeTreeDataEmitter: vs.EventEmitter<FlutterWidgetItem | undefined> = new vs.EventEmitter<FlutterWidgetItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<FlutterWidgetItem | undefined> = this.onDidChangeTreeDataEmitter.event;
	protected lastSelectedWidget: FlutterWidgetItem | undefined;
	public numOutstandingSelectionEvents = 0;

	constructor(private readonly analyzer: LspAnalyzer) {
		this.analyzer.fileTracker.onFlutterOutline((n) => {
			if (this.activeEditor && fsPath(vs.Uri.parse(n.uri)) === fsPath(this.activeEditor.document.uri)) {
				this.flutterOutline = n.outline;
				this.treeNodesByLine = [];
				// Delay this so if we're getting lots of updates we don't flicker.
				if (this.updateTimeout)
					clearTimeout(this.updateTimeout);
				if (!this.rootNode)
					void this.update();
				else
					this.updateTimeout = setTimeout(() => this.update(), 200);
			}
		});

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor) {
			this.setTrackingFile(vs.window.activeTextEditor);
		}
	}

	protected async loadExistingOutline() {
		this.flutterOutline = this.activeEditor ? this.analyzer.fileTracker.getFlutterOutlineFor(this.activeEditor.document.uri) : undefined;
		if (this.flutterOutline)
			await this.update();
		else {
			this.rootNode = undefined;
			this.refresh(); // Force update (to nothing) while requests are in-flight.
		}
	}

	private async update() {
		// Build the tree from our outline
		if (this.flutterOutline) {
			this.rootNode = await this.createTreeNode(undefined, this.flutterOutline, this.activeEditor);
			FlutterOutlineProvider.showTree();
		} else {
			this.rootNode = undefined;
			FlutterOutlineProvider.hideTree();
		}
		this.refresh();
	}

	private async createTreeNode(parent: FlutterWidgetItem | undefined, outline: FlutterOutline, editor: vs.TextEditor | undefined): Promise<FlutterWidgetItem | undefined> {
		// Ensure we're still active editor before trying to use.
		if (editor?.document && !editor.document.isClosed && this.activeEditor === editor) {
			const node = new FlutterWidgetItem(parent, outline, editor);

			// Add this node to a lookup by line so we can quickly find it as the user moves around the doc.
			const startLine = outline.range.start.line;
			const endLine = outline.range.end.line;
			for (let line = startLine; line <= endLine; line++) {
				if (!this.treeNodesByLine[line]) {
					this.treeNodesByLine[line] = [];
				}
				this.treeNodesByLine[line].push(node);
			}
			if (outline.children)
				node.children = (await Promise.all(outline.children.map((c) => this.createTreeNode(node, c, editor)))).filter((n) => n).map((n) => n!);

			return node;
		}

		return undefined;
	}

	protected setTrackingFile(editor: vs.TextEditor | undefined) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			void this.loadExistingOutline();
		} else if (editor && editor.document.uri.scheme === "file") {
			// HACK: We can't currently reliably tell when editors are changed that are only real
			// text editors (debug window is considered an editor) so we should only hide the tree
			// when we know a file that is not ours is selected.
			// https://github.com/Microsoft/vscode/issues/45188
			this.activeEditor = undefined;
			FlutterOutlineProvider.hideTree();
		} else {
			// HACK: If there are no valid open editors, hide the tree.
			// The timeout is because the open editors disappear briefly during a closing
			// of one preview and opening of another :(
			// https://github.com/Microsoft/vscode/issues/45188.
			setTimeout(() => {
				if (!vs.window.visibleTextEditors.filter((e) => isAnalyzable(e.document)).length) {
					FlutterOutlineProvider.hideTree();
				}
			}, 100);
		}
	}

	public async handleSelection(selection: readonly FlutterWidgetItem[] | undefined) {
		// Unmark the old node as being selected.
		if (this.lastSelectedWidget) {
			const widget = this.lastSelectedWidget;
			widget.contextValue = undefined;
			// If we refresh immediately, we may cause "actual command not found" for the
			// navigation command.
			setTimeout(() => this.refresh(widget), 200);
		}

		// Clear all contexts that enabled refactors.
		for (const refactor of flutterOutlineCommands) {
			void vs.commands.executeCommand("setContext", WIDGET_SUPPORTS_CONTEXT_PREFIX + refactor, false);
		}

		// Set up the new contexts for our node and mark is as current.
		if (this.activeEditor && selection && selection.length === 1 && isWidget(selection[0].outline)) {
			const fixes = (await getFixes(this.activeEditor, selection[0].outline))
				.filter((f): f is vs.CodeAction => f instanceof vs.CodeAction)
				.filter((ca) => ca.kind?.value && flutterOutlineCommands.includes(ca.kind.value));

			// Stash the fixes, as we may need to call them later.
			selection[0].fixes = fixes;

			for (const fix of fixes)
				void vs.commands.executeCommand("setContext", WIDGET_SUPPORTS_CONTEXT_PREFIX + (fix.kind ? fix.kind.value : "NOKIND"), true);

			// Used so we can show context menu if you right-click the selected one.
			// We can't support arbitrary context menus, because we can't get the fixes up-front (see
			// https://github.com/dart-lang/sdk/issues/32462) so we fetch when you select an item
			// and then just support it if it's selected.
			selection[0].contextValue = WIDGET_SELECTED_CONTEXT;
			const widget = this.lastSelectedWidget = selection[0];
			// If we refresh immediately, we may cause "actual command not found" for the
			// navigation command.
			setTimeout(() => this.refresh(widget), 200);
		}
	}

	public getNodeAt(uri: vs.Uri, pos: vs.Position): FlutterWidgetItem | undefined {
		if (!this.activeEditor || !this.flutterOutline || fsPath(this.activeEditor.document.uri) !== fsPath(uri) || !this.treeNodesByLine[pos.line])
			return;

		const nodes = this.treeNodesByLine[pos.line];
		// We want the last node that started before the position (eg. most specific).
		let currentBest: FlutterWidgetItem | undefined;
		for (const item of nodes) {
			const range = "range" in item.outline
				? lspToRange(item.outline.range)
				: toRange(this.activeEditor.document, item.outline.offset, item.outline.length);
			if (range.contains(pos))
				currentBest = item;
		}

		if (currentBest === this.rootNode)
			return undefined; // Root node isn't actually in the tree.

		return currentBest;
	}

	public refresh(item?: FlutterWidgetItem): void {
		this.onDidChangeTreeDataEmitter.fire(item);
	}

	public getTreeItem(element: FlutterWidgetItem): vs.TreeItem {
		return element;
	}

	public getChildren(element?: FlutterWidgetItem): FlutterWidgetItem[] {
		if (element)
			return element.children;
		if (this.rootNode)
			return this.rootNode.children;
		return [];
	}

	public getParent(element: FlutterWidgetItem): FlutterWidgetItem | undefined {
		return element.parent;
	}

	private static setTreeVisible(visible: boolean) {
		void vs.commands.executeCommand("setContext", DART_SHOW_FLUTTER_OUTLINE, visible);
	}

	public static showTree() { this.setTreeVisible(true); }
	public static hideTree() { this.setTreeVisible(false); }

	public dispose() {
		this.activeEditor = undefined;
		disposeAll(this.subscriptions);
	}
}


function isWidget(outline: CommonOutline) {
	return outline.kind !== "DART_ELEMENT";
}

async function getFixes(editor: vs.TextEditor, outline: CommonOutline): Promise<Array<vs.Command | vs.CodeAction>> {
	const pos = "range" in outline
		? lspToPosition(outline.range.start)
		: editor.document.positionAt(outline.offset);
	const range = new vs.Range(pos, pos);
	const fixes: Array<vs.Command | vs.CodeAction> | undefined = await vs.commands.executeCommand(
		"vscode.executeCodeActionProvider",
		editor.document.uri,
		range,
	);
	return fixes || [];
}

type CommonOutline = {
	attributes?: Array<{ name: string, label: string }>;
	variableName?: string;
	className?: string;
	label?: string;
	children?: CommonOutline[];
	dartElement?: {
		kind: string;
		name: string,
		parameters?: string,
		returnType?: string,
		typeParameters?: string
	};
	kind: string;
} & (
		{ range: lsp.Range, codeRange: lsp.Range, dartElement?: { range?: lsp.Range } }
		| { offset: number, length: number, codeOffset: number, codeLength: number, dartElement?: { location?: { offset?: number } } }
	);

export class FlutterWidgetItem extends vs.TreeItem {
	public children: FlutterWidgetItem[] = [];
	public fixes: vs.CodeAction[] = [];
	constructor(
		public readonly parent: FlutterWidgetItem | undefined,
		public readonly outline: CommonOutline,
		editor: vs.TextEditor,
	) {
		super(
			FlutterWidgetItem.getLabel(outline),
			(outline.children?.length)
				? vs.TreeItemCollapsibleState.Expanded
				: vs.TreeItemCollapsibleState.None,
		);

		this.description = FlutterWidgetItem.getDescription(outline);
		if (isWidget(outline)) {
			this.iconPath = vs.Uri.file(path.join(extensionPath, "media/icons/flutter_outline/widget.svg"));
		} else if (outline.dartElement) {
			const icon = getIconForSymbolKind(getSymbolKindForElementKind(nullLogger, outline.dartElement.kind));
			this.iconPath = {
				dark: vs.Uri.file(path.join(extensionPath, `media/icons/vscode_symbols/${icon}-dark.svg`)),
				light: vs.Uri.file(path.join(extensionPath, `media/icons/vscode_symbols/${icon}-light.svg`)),
			};
		}

		const displayRange = "range" in outline
			? outline.range
			: new vs.Range(
				editor.document.positionAt(outline.offset),
				editor.document.positionAt(outline.offset + outline.length),
			);

		const highlightRange = "codeRange" in outline
			? outline.codeRange
			: new vs.Range(
				editor.document.positionAt(outline.codeOffset),
				editor.document.positionAt(outline.codeOffset + outline.codeLength),
			);

		const selectionPos = "range" in outline
			? outline.dartElement && outline.dartElement.range
				? lspToPosition(outline.dartElement.range.start)
				: lspToPosition(outline.range.start)
			: outline.dartElement && outline.dartElement.location?.offset
				? editor.document.positionAt(outline.dartElement.location.offset)
				: editor.document.positionAt(outline.offset);

		this.command = {
			arguments: [
				editor,
				// Code to fit on screen
				displayRange,
				// Code to highlight
				highlightRange,
				// Selection (we just want to move cursor, so it's 0-length)
				new vs.Range(selectionPos, selectionPos),
			],
			command: "_dart.showCode",
			title: "",
		};

		this.tooltip = treeLabel(this);
		if (outline.attributes?.length) {
			this.tooltip += "\n  " + outline.attributes.map((a) => `${a.name}: ${a.label}`).join("\n   ");
		}
	}

	private static getLabel(outline: CommonOutline): string {
		let label = "";

		if (outline.dartElement) {
			label += " " + outline.dartElement.name;
			if (outline.dartElement.typeParameters)
				label += outline.dartElement.typeParameters;
		}

		if (outline.variableName)
			label += " " + outline.variableName;

		if (outline.className)
			label += " " + outline.className;

		if (outline.label)
			label += " " + outline.label;

		return label.trim();
	}

	private static getDescription(outline: CommonOutline): string | undefined {
		let label = "";

		if (outline.dartElement) {
			if (outline.dartElement.parameters)
				label += outline.dartElement.parameters;
			if (outline.dartElement.returnType)
				label += " → " + outline.dartElement.returnType;
		}

		// Prefer an attribute named "data", but otherwise try some others
		// in order that appear useful.
		const attributeToShow = outline.attributes?.find((a) => a.name === "data")
			|| outline.attributes?.find((a) => a.name === "icon" || a.name === "value");
		if (attributeToShow)
			label += " " + attributeToShow.label;

		return label.trim();
	}
}


function getSymbolKindForElementKind(logger: Logger, kind: ElementKind | string): vs.SymbolKind {
	switch (kind) {
		case "CLASS":
		case "CLASS_TYPE_ALIAS":
		case "MIXIN":
			return vs.SymbolKind.Class;
		case "COMPILATION_UNIT":
		case "EXTENSION":
			return vs.SymbolKind.Module;
		case "CONSTRUCTOR":
		case "CONSTRUCTOR_INVOCATION":
			return vs.SymbolKind.Constructor;
		case "ENUM":
			return vs.SymbolKind.Enum;
		case "ENUM_CONSTANT":
			return vs.SymbolKind.EnumMember;
		case "FIELD":
			return vs.SymbolKind.Field;
		case "FILE":
			return vs.SymbolKind.File;
		case "FUNCTION":
		case "FUNCTION_INVOCATION":
		case "FUNCTION_TYPE_ALIAS":
			return vs.SymbolKind.Function;
		case "GETTER":
			return vs.SymbolKind.Property;
		case "LABEL":
			return vs.SymbolKind.Module;
		case "LIBRARY":
			return vs.SymbolKind.Namespace;
		case "LOCAL_VARIABLE":
			return vs.SymbolKind.Variable;
		case "METHOD":
			return vs.SymbolKind.Method;
		case "PARAMETER":
		case "PREFIX":
			return vs.SymbolKind.Variable;
		case "SETTER":
			return vs.SymbolKind.Property;
		case "TOP_LEVEL_VARIABLE":
		case "TYPE_PARAMETER":
			return vs.SymbolKind.Variable;
		case "UNIT_TEST_GROUP":
			return vs.SymbolKind.Module;
		case "UNIT_TEST_TEST":
			return vs.SymbolKind.Method;
		case "UNKNOWN":
			return vs.SymbolKind.Object;
		default:
			logger.error(`Unknown kind: ${kind}`, LogCategory.Analyzer);
			return vs.SymbolKind.Object;
	}
}

/**
 * An enumeration of the kinds of elements.
 */
type ElementKind =
	"CLASS"
	| "CLASS_TYPE_ALIAS"
	| "COMPILATION_UNIT"
	| "CONSTRUCTOR"
	| "CONSTRUCTOR_INVOCATION"
	| "ENUM"
	| "ENUM_CONSTANT"
	| "EXTENSION"
	| "FIELD"
	| "FILE"
	| "FUNCTION"
	| "FUNCTION_INVOCATION"
	| "FUNCTION_TYPE_ALIAS"
	| "GETTER"
	| "LABEL"
	| "LIBRARY"
	| "LOCAL_VARIABLE"
	| "METHOD"
	| "MIXIN"
	| "PARAMETER"
	| "PREFIX"
	| "SETTER"
	| "TOP_LEVEL_VARIABLE"
	| "TYPE_ALIAS"
	| "TYPE_PARAMETER"
	| "UNIT_TEST_GROUP"
	| "UNIT_TEST_TEST"
	| "UNKNOWN";
