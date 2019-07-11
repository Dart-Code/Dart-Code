"use strict";

import * as path from "path";
import * as vs from "vscode";
import * as as from "../../shared/analysis_server_types";
import { nullLogger } from "../../shared/logging";
import { getIconForSymbolKind } from "../../shared/vscode/mappings";
import { fsPath } from "../../shared/vscode/utils";
import { Analyzer, getSymbolKindForElementKind } from "../analysis/analyzer";
import { flutterOutlineCommands } from "../commands/flutter_outline";
import { extensionPath, isAnalyzable } from "../utils";

const DART_SHOW_FLUTTER_OUTLINE = "dart-code:showFlutterOutline";
const WIDGET_SELECTED_CONTEXT = "dart-code:isSelectedWidget";
const WIDGET_SUPPORTS_CONTEXT_PREFIX = "dart-code:widgetSupports:";

export class FlutterOutlineProvider implements vs.TreeDataProvider<FlutterWidgetItem>, vs.Disposable {
	private subscriptions: vs.Disposable[] = [];
	private activeEditor: vs.TextEditor;
	private flutterOutline: as.FlutterOutlineNotification;
	private rootNode: FlutterWidgetItem;
	private treeNodesByLine: { [key: number]: FlutterWidgetItem[]; } = [];
	private updateTimeout: NodeJS.Timer;
	private onDidChangeTreeDataEmitter: vs.EventEmitter<FlutterWidgetItem | undefined> = new vs.EventEmitter<FlutterWidgetItem | undefined>();
	public readonly onDidChangeTreeData: vs.Event<FlutterWidgetItem | undefined> = this.onDidChangeTreeDataEmitter.event;
	private lastSelectedWidget: FlutterWidgetItem | undefined;

	constructor(private readonly analyzer: Analyzer) {
		this.analyzer = analyzer;
		this.analyzer.registerForFlutterOutline((n) => {
			if (this.activeEditor && n.file === fsPath(this.activeEditor.document.uri)) {
				this.flutterOutline = n;
				this.treeNodesByLine = [];
				// Delay this so if we're getting lots of updates we don't flicker.
				clearTimeout(this.updateTimeout);
				this.updateTimeout = setTimeout(() => this.update(), 200);
			}
		});

		this.subscriptions.push(vs.window.onDidChangeActiveTextEditor((e) => this.setTrackingFile(e)));
		if (vs.window.activeTextEditor) {
			this.setTrackingFile(vs.window.activeTextEditor);
		}
	}

	private async update() {
		// Build the tree from our outline
		this.rootNode = await this.createTreeNode(null, this.flutterOutline.outline, this.activeEditor);

		FlutterOutlineProvider.showTree();
		this.refresh();
	}

	private async createTreeNode(parent: FlutterWidgetItem, element: as.FlutterOutline, editor: vs.TextEditor): Promise<FlutterWidgetItem> {
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
				node.children = await Promise.all(element.children.map((c) => this.createTreeNode(node, c, editor)));

			return node;
		}
	}

	private setTrackingFile(editor: vs.TextEditor) {
		if (editor && isAnalyzable(editor.document)) {
			this.activeEditor = editor;
			this.flutterOutline = null;
			this.refresh(); // Force update (to nothing) while requests are in-flight.
			this.analyzer.forceNotificationsFor(fsPath(editor.document.uri));
		} else if (editor && editor.document.uri.scheme === "file") {
			// HACK: We can't currently reliably tell when editors are changed that are only real
			// text editors (debug window is considered an editor) so we should only hide the tree
			// when we know a file that is not ours is selected.
			// https://github.com/Microsoft/vscode/issues/45188
			this.activeEditor = null;
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
		if (selection && selection.length === 1 && isWidget(selection[0].outline)) {
			const fixes = (await getFixes(this.activeEditor, selection[0].outline))
				.filter((f): f is vs.CodeAction => f instanceof vs.CodeAction)
				.filter((ca) => ca.kind && ca.kind.value && flutterOutlineCommands.indexOf(ca.kind.value) !== -1);

			// Stash the fixes, as we may need to call them later.
			selection[0].fixes = fixes;

			for (const fix of fixes)
				vs.commands.executeCommand("setContext", WIDGET_SUPPORTS_CONTEXT_PREFIX + fix.kind.value, true);

			// Used so we can show context menu if you right-click the selected one.
			// We can't support arbitrary context menus, because we can't get the fixes up-front (see
			// https://github.com/dart-lang/sdk/issues/32462) so we fetch when you select an item
			// and then just support it if it's selected.
			selection[0].contextValue = WIDGET_SELECTED_CONTEXT;
			this.lastSelectedWidget = selection[0];
			this.refresh(selection[0]);
		}
	}

	public getNodeAt(uri: vs.Uri, pos: vs.Position) {
		if (this.flutterOutline.file !== fsPath(uri) || !this.treeNodesByLine[pos.line])
			return;

		const offset = this.activeEditor.document.offsetAt(pos);
		const nodes = this.treeNodesByLine[pos.line];
		// We want the last node that started before the position (eg. most specific).
		let currentBest = null;
		for (const item of nodes) {
			if (item.outline.offset <= offset
				&& item.outline.offset + item.outline.length >= offset) {
				currentBest = item;
			}
		}

		if (currentBest === this.rootNode)
			return null; // Root node isn't actually in the tree.

		return currentBest;
	}

	public refresh(item?: FlutterWidgetItem | undefined): void {
		this.onDidChangeTreeDataEmitter.fire(item);
	}

	public getTreeItem(element: FlutterWidgetItem): vs.TreeItem {
		return element;
	}

	public getChildren(element?: FlutterWidgetItem): FlutterWidgetItem[] {
		return element
			? element.children
			: this.rootNode.children;
	}

	public getParent(element: FlutterWidgetItem): FlutterWidgetItem {
		return element.parent;
	}

	private static setTreeVisible(visible: boolean) {
		vs.commands.executeCommand("setContext", DART_SHOW_FLUTTER_OUTLINE, visible);
	}

	public static showTree() { this.setTreeVisible(true); }
	public static hideTree() { this.setTreeVisible(false); }

	public dispose() {
		this.activeEditor = null;
		this.subscriptions.forEach((s) => s.dispose());
	}
}

function isWidget(outline: as.FlutterOutline) {
	return outline.kind !== "DART_ELEMENT";
}

function getFixes(editor: vs.TextEditor, outline: as.FlutterOutline): Thenable<Array<vs.Command | vs.CodeAction>> {
	const pos = editor.document.positionAt(outline.offset);
	const range = new vs.Range(pos, pos);
	return vs.commands.executeCommand(
		"vscode.executeCodeActionProvider",
		editor.document.uri,
		range,
	);
}

export class FlutterWidgetItem extends vs.TreeItem {
	public children: FlutterWidgetItem[];
	public fixes: vs.CodeAction[];
	constructor(
		public readonly parent: FlutterWidgetItem,
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
			this.iconPath = path.join(extensionPath, "media/icons/flutter.svg");
		} else if (outline.dartElement) {
			const icon = getIconForSymbolKind(getSymbolKindForElementKind(nullLogger, outline.dartElement.kind));
			this.iconPath = {
				dark: path.join(extensionPath, `media/icons/vscode_symbols/${icon}-dark.svg`),
				light: path.join(extensionPath, `media/icons/vscode_symbols/${icon}-light.svg`),
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
					editor.document.positionAt((outline.dartElement ? outline.dartElement.location : outline).offset),
					editor.document.positionAt((outline.dartElement ? outline.dartElement.location : outline).offset),
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
