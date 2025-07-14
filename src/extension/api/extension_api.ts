import * as vs from "vscode";
import { Range } from "vscode-languageclient";
import { Element, Outline } from "../../shared/analysis/lsp/custom_protocol";
import { Sdks } from "../../shared/interfaces";
import { ProjectFinder } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer";
import { config } from "../config";
import { getExcludedFolders } from "../utils";
import { PublicDartExtensionApi, PublicElement, PublicOutline, PublicSdks, PublicWorkspace } from "./interfaces";

/// A single instance of this class is created (below) that is used internally to modify the data
/// provided by the API.
class DartExtensionApiModel {
	public readonly version = 2;

	public sdks: Sdks | undefined;
	public dtdUri: string | undefined;
	public analyzer: LspAnalyzer | undefined;
	public projectFinder: ProjectFinder | undefined;

	private onSdksChangedEmitter = new vs.EventEmitter<Sdks | undefined>();
	public readonly onSdksChanged = this.onSdksChangedEmitter.event;

	private onDtdUriChangedEmitter = new vs.EventEmitter<string | undefined>();
	public readonly onDtdUriChanged = this.onDtdUriChangedEmitter.event;

	public setSdks(sdks: Sdks | undefined) {
		this.sdks = sdks;
		this.onSdksChangedEmitter.fire(sdks);
	}

	public setDtdUri(dtdUri: string | undefined) {
		this.dtdUri = dtdUri;
		this.onDtdUriChangedEmitter.fire(dtdUri);
	}

	public setAnalyzer(analyzer: LspAnalyzer | undefined) {
		this.analyzer = analyzer;
	}

	public setProjectFinder(projectFinder: ProjectFinder) {
		this.projectFinder = projectFinder;
	}

	public clear(): void {
		this.setSdks(undefined);
		this.setDtdUri(undefined);
		this.setAnalyzer(undefined);
		this.projectFinder = undefined;
	}
}

/// Use a single global static to store data exposed by the extension so that we don't
/// need to worry about different API objects being created during the lifetime of the
/// extension (for example during internal restarts).
export const extensionApiModel = new DartExtensionApiModel();
const data = extensionApiModel;

export class PublicDartExtensionApiImpl implements PublicDartExtensionApi {
	// All data returned from this class should be immutable/copies so that
	// callers cannot modify the values read by other extensions.

	private readonly workspaceImpl = new PublicWorkspaceImpl();

	public get version() { return extensionApiModel.version; };

	public get sdks(): PublicSdks {
		return data.sdks ? { ...data.sdks } : {};
	}

	public get onSdksChanged(): vs.Event<PublicSdks> {
		return (listener, thisArgs?, disposables?) =>
			data.onSdksChanged((sdks) => {
				const publicSdks: PublicSdks = sdks ? { ...sdks } : {};
				listener.call(thisArgs, publicSdks);
			}, thisArgs, disposables);
	}

	public get dtdUri(): string | undefined {
		return data.dtdUri;
	}

	public get onDtdUriChanged(): vs.Event<string | undefined> {
		return data.onDtdUriChanged;
	}

	public get workspace(): PublicWorkspace {
		return this.workspaceImpl;
	}
}

class PublicWorkspaceImpl implements PublicWorkspace {
	// All data returned from this class should be immutable/copies so that
	// callers cannot modify the values read by other extensions.

	public async getOutline(document: vs.TextDocument, token?: vs.CancellationToken): Promise<PublicOutline | undefined> {
		if (!data.analyzer)
			return undefined;

		const outline = await data.analyzer.fileTracker.waitForOutline(document, token);
		return outline ? this.convertToPublicOutline(outline) : undefined;
	}

	public async findProjectFolders(): Promise<string[]> {
		if (!data.projectFinder)
			return [];

		const searchOptions = {
			sort: true,
			requirePubspec: true,
			searchDepth: config.projectSearchDepth,
		};

		return data.projectFinder.findAllProjectFolders(getExcludedFolders, searchOptions);
	}

	private convertToPublicOutline(outline: Outline): PublicOutline {
		return {
			element: this.convertToPublicElement(outline.element),
			range: this.convertToVsRange(outline.range),
			codeRange: this.convertToVsRange(outline.codeRange),
			children: outline.children?.map((child) => this.convertToPublicOutline(child)),
		};
	}

	private convertToPublicElement(element: Element): PublicElement {
		return {
			name: element.name,
			range: element.range ? this.convertToVsRange(element.range) : undefined,
			kind: element.kind,
			parameters: element.parameters,
			typeParameters: element.typeParameters,
			returnType: element.returnType,
		};
	}

	private convertToVsRange(range: Range): vs.Range {
		return new vs.Range(
			this.convertToVsPosition(range.start),
			this.convertToVsPosition(range.end),
		);
	}

	private convertToVsPosition(position: { line: number; character: number }): vs.Position {
		return new vs.Position(
			position.line,
			position.character,
		);
	}
}
