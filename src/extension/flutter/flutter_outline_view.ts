import * as path from "path";
import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { nullLogger } from "../../shared/logging";
import { fsPath } from "../../shared/utils/fs";
import { extensionPath } from "../../shared/vscode/extension_utils";
import { getIconForSymbolKind } from "../../shared/vscode/mappings";
import { DasAnalyzer, getSymbolKindForElementKind } from "../analysis/analyzer_das";
import { flutterOutlineCommands } from "../commands/flutter_outline";
import { isAnalyzable } from "../utils";

const DART_SHOW_FLUTTER_OUTLINE = "dart-code:showFlutterOutline";
const WIDGET_SELECTED_CONTEXT = "dart-code:isSelectedWidget";
const WIDGET_SUPPORTS_CONTEXT_PREFIX = "dart-code:widgetSupports:";

abstract class FlutterOutlineProvider<TRoot> implements vs.TreeDataProvider<FlutterWidgetItem>, vs.Disposable {
	protected subscriptions: vs.Disposable[] = [];
	protected activeEditor: vs.TextEditor | undefined;
	protected flutterOutline: TRoot | undefined;
	protected rootNode: FlutterWidgetItem | undefined;
	protected treeNodesByLine: { [key: number]: FlutterWidgetItem[]; } = [];
	protected updateTimeout: NodeJS.Timer | undefined;
	protected onDidChangeTreeDataEmitter: vs.EventEmitter<FlutterWidgetItem | undefined> = new vs.EventEmitter<FlutterWidgetItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<FlutterWidgetItem | undefined> = this.onDidChangeTreeDataEmitter.event;
	protected lastSelectedWidget: FlutterWidgetItem | undefined;

	protected setTrackingFile(editor: vs.TextEditor | undefined) {
		if (editor && isAnalyzable(editor.document)) {
			this.loadExistingOutline();
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

	protected abstract loadExistingOutline(): void;

	public async setContexts(selection: FlutterWidgetItem[]) {
		// Unmark the old node as being selected.
		if (this.lastSelectedWidget) {
			this.lastSelectedWidget.contextValue = undefined;
			this.refresh(this.lastSelectedWidget);
		}

		// Clear all contexts that enabled refactors.
		for (const refactor of flutterOutlineCommands) {
			vs.commands.executeCommand("setContext", WIDGET_SUPPORTS_CONTEXT_PREFIX + refactor, false);
		}

		// Set up the new contexts for our node and mark is as current.
		if (this.activeEditor && selection && selection.length === 1 && isWidget(selection[0].outline)) {
			const fixes = (await getFixes(this.activeEditor, selection[0].outline))
				.filter((f): f is vs.CodeAction => f instanceof vs.CodeAction)
				.filter((ca) => ca.kind && ca.kind.value && flutterOutlineCommands.indexOf(ca.kind.value) !== -1);

			// Stash the fixes, as we may need to call them later.
			selection[0].fixes = fixes;

			for (const fix of fixes)
				vs.commands.executeCommand("setContext", WIDGET_SUPPORTS_CONTEXT_PREFIX + (fix.kind ? fix.kind.value : "NOKIND"), true);

			// Used so we can show context menu if you right-click the selected one.
			// We can't support arbitrary context menus, because we can't get the fixes up-front (see
			// https://github.com/dart-lang/sdk/issues/32462) so we fetch when you select an item
			// and then just support it if it's selected.
			selection[0].contextValue = WIDGET_SELECTED_CONTEXT;
			this.lastSelectedWidget = selection[0];
			this.refresh(selection[0]);
		}
	}

	public getNodeAt(uri: vs.Uri, pos: vs.Position): FlutterWidgetItem | undefined {
		if (!this.activeEditor || !this.flutterOutline || fsPath(this.activeEditor.document.uri) !== fsPath(uri) || !this.treeNodesByLine[pos.line])
			return;

		const offset = this.activeEditor.document.offsetAt(pos);
		const nodes = this.treeNodesByLine[pos.line];
		// We want the last node that started before the position (eg. most specific).
		let currentBest: FlutterWidgetItem | undefined;
		for (const item of nodes) {
			if (item.outline.offset <= offset
				&& item.outline.offset + item.outline.length >= offset) {
				currentBest = item;
			}
		}

		if (currentBest === this.rootNode)
			return undefined; // Root node isn't actually in the tree.

		return currentBest;
	}

	public refresh(item?: FlutterWidgetItem | undefined): void {
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
		vs.commands.executeCommand("setContext", DART_SHOW_FLUTTER_OUTLINE, visible);
	}

	public static showTree() { this.setTreeVisible(true); }
	public static hideTree() { this.setTreeVisible(false); }

	public dispose() {
		this.activeEditor = undefined;
		this.subscriptions.forEach((s) => s.dispose());
	}
}

export class DasFlutterOutlineProvider extends FlutterOutlineProvider<as.FlutterOutline> {
	constructor(protected readonly analyzer: DasAnalyzer) {
		super();
		this.analyzer.client.registerForServerConnected((c) => {
			if (analyzer.client.capabilities.supportsFlutterOutline) {
				this.analyzer.client.registerForFlutterOutline((n) => {
					if (this.activeEditor && n.file === fsPath(this.activeEditor.document.uri)) {
						this.flutterOutline = n.outline;
						this.treeNodesByLine = [];
						// Delay this so if we're getting lots of updates we don't flicker.
						if (this.updateTimeout)
							clearTimeout(this.updateTimeout);
						if (!this.rootNode)
							this.update();
						else
							this.updateTimeout = setTimeout(() => this.update(), 200);
					}
				});

				this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
				if (vs.window.activeTextEditor) {
					this.setTrackingFile(vs.window.activeTextEditor);
				}
			}
		});
	}

	protected loadExistingOutline() {
		this.flutterOutline = this.activeEditor ? this.analyzer.fileTracker.getFlutterOutlineFor(this.activeEditor.document.uri) : undefined;
		if (this.flutterOutline)
			this.update();
		else {
			this.rootNode = undefined;
			this.refresh(); // Force update (to nothing) while requests are in-flight.
		}
		if (this.activeEditor)
			this.analyzer.client.forceNotificationsFor(fsPath(this.activeEditor.document.uri));
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

	private async createTreeNode(parent: FlutterWidgetItem | undefined, element: as.FlutterOutline, editor: vs.TextEditor | undefined): Promise<FlutterWidgetItem | undefined> {
		// Ensure we're still active editor before trying to use.
		if (editor && editor.document && !editor.document.isClosed && this.activeEditor === editor) {
			const node = new FlutterWidgetItem(parent, element, editor);

			// Add this node to a lookup by line so we can quickly find it as the user moves around the doc.
			const startLine = editor.document.positionAt(element.offset).line;
			const endLine = editor.document.positionAt(element.offset + element.length).line;
			for (let line = startLine; line <= endLine; line++) {
				if (!this.treeNodesByLine[line]) {
					this.treeNodesByLine[line] = [];
				}
				this.treeNodesByLine[line].push(node);
			}
			if (element.children)
				node.children = (await Promise.all(element.children.map((c) => this.createTreeNode(node, c, editor)))).filter((n) => n).map((n) => n!);

			return node;
		}

		return undefined;
	}
}

function isWidget(outline: as.FlutterOutline) {
	return outline.kind !== "DART_ELEMENT";
}

async function getFixes(editor: vs.TextEditor, outline: as.FlutterOutline): Promise<Array<vs.Command | vs.CodeAction>> {
	const pos = editor.document.positionAt(outline.offset);
	const range = new vs.Range(pos, pos);
	const fixes: Array<vs.Command | vs.CodeAction> | undefined = await vs.commands.executeCommand(
		"vscode.executeCodeActionProvider",
		editor.document.uri,
		range,
	);
	return fixes || [];
}

export class FlutterWidgetItem extends vs.TreeItem {
	public children: FlutterWidgetItem[] = [];
	public fixes: vs.CodeAction[] = [];
	constructor(
		public readonly parent: FlutterWidgetItem | undefined,
		public readonly outline: as.FlutterOutline,
		editor: vs.TextEditor,
	) {
		super(
			FlutterWidgetItem.getLabel(outline),
			(outline.children && outline.children.length)
				? vs.TreeItemCollapsibleState.Expanded
				: vs.TreeItemCollapsibleState.None,
		);

		if (isWidget(outline)) {
			this.iconPath = vs.Uri.file(path.join(extensionPath, "media/icons/flutter_widget.svg"));
		} else if (outline.dartElement) {
			const icon = getIconForSymbolKind(getSymbolKindForElementKind(nullLogger, outline.dartElement.kind));
			this.iconPath = {
				dark: vs.Uri.file(path.join(extensionPath, `media/icons/vscode_symbols/${icon}-dark.svg`)),
				light: vs.Uri.file(path.join(extensionPath, `media/icons/vscode_symbols/${icon}-light.svg`)),
			};
		}

		this.command = {
			arguments: [
				editor,
				// Code to fit on screen
				new vs.Range(
					editor.document.positionAt(outline.offset),
					editor.document.positionAt(outline.offset + outline.length),
				),
				// Code to highlight
				new vs.Range(
					editor.document.positionAt(outline.codeOffset),
					editor.document.positionAt(outline.codeOffset + outline.codeLength),
				),
				// Selection (we just want to move cursor, so it's 0-length)
				new vs.Range(
					editor.document.positionAt((outline.dartElement ? outline.dartElement.location! : outline).offset),
					editor.document.positionAt((outline.dartElement ? outline.dartElement.location! : outline).offset),
				),
			],
			command: "_dart.showCode",
			title: "",
		};

		this.tooltip = this.label;
		if (outline.attributes) {
			this.tooltip += "\n  " + outline.attributes.map((a) => `${a.name}: ${a.label}`).join("\n   ");
		}
	}

	private static getLabel(outline: as.FlutterOutline): string {
		let label = "";

		if (outline.dartElement) {
			label += " " + outline.dartElement.name;
			if (outline.dartElement.typeParameters)
				label += outline.dartElement.typeParameters;
			if (outline.dartElement.parameters)
				label += outline.dartElement.parameters;
			if (outline.dartElement.returnType)
				label += " → " + outline.dartElement.returnType;
		}

		if (outline.variableName)
			label += " " + outline.variableName;

		if (outline.className)
			label += " " + outline.className;

		if (outline.label)
			label += " " + outline.label;

		return label.trim();
	}
}
