import path from "path";
import * as vs from "vscode";
import { Range } from "vscode-languageclient";
import { Element, Outline } from "../../shared/analysis/lsp/custom_protocol";
import { dartVMPath } from "../../shared/constants";
import { Sdks } from "../../shared/interfaces";
import { ProjectFinder } from "../../shared/vscode/utils";
import { LspAnalyzer } from "../analysis/analyzer";
import { SdkCommands } from "../commands/sdk";
import { config } from "../config";
import { safeToolSpawn } from "../utils/processes";
import { FeatureOverrideManager } from "./feature_overrides";
import { PublicCodeLens, PublicCodeLensSuppressOptions, PublicDartExtensionApi, PublicElement, PublicFeatures, PublicOutline, PublicRunOptions, PublicRunResult, PublicSdk, PublicSdks, PublicStartResult, PublicWorkspace } from "./interfaces";

/// A single instance of this class is created (below) that is used internally to modify the data
/// provided by the API.
class DartExtensionApiModel {
	public readonly version = 3;

	public sdks: Sdks | undefined;
	public dtdUri: string | undefined;
	public analyzer: LspAnalyzer | undefined;
	public projectFinder: ProjectFinder | undefined;
	public sdkCommands: SdkCommands | undefined;

	public readonly codeLensSuppressions = new FeatureOverrideManager<PublicCodeLensSuppressOptions>();

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

	public setProjectFinder(projectFinder: ProjectFinder | undefined) {
		this.projectFinder = projectFinder;
	}

	public setSdkCommands(sdkCommands: SdkCommands | undefined) {
		this.sdkCommands = sdkCommands;
	}

	public clear(): void {
		this.setSdks(undefined);
		this.setDtdUri(undefined);
		this.setAnalyzer(undefined);
		this.setProjectFinder(undefined);
		this.setSdkCommands(undefined);
		this.codeLensSuppressions.clear();
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
	private readonly sdkImpl = new PublicSdkImpl();
	private readonly featuresImpl = new PublicFeaturesImpl();

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

	public get sdk(): PublicSdk {
		return this.sdkImpl;
	}

	public get features(): PublicFeatures {
		return this.featuresImpl;
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

		return data.projectFinder.findAllProjectFolders(searchOptions);
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

class PublicSdkImpl implements PublicSdk {
	// All data returned from this class should be immutable/copies so that
	// callers cannot modify the values read by other extensions.

	public async runDart(folder: string, args: string[], options?: PublicRunOptions): Promise<PublicRunResult | undefined> {
		if (!data.sdkCommands || !data.sdks?.dart)
			throw new Error("Dart SDK not available");

		return data.sdkCommands.runDartCommand(folder, args, options);
	}

	public async runPub(folder: string, args: string[], options?: PublicRunOptions): Promise<PublicRunResult | undefined> {
		return this.runDart(folder, ["pub", ...args], options);
	}

	public async startDart(folder: string, args: string[]): Promise<PublicStartResult> {
		if (!data.sdks?.dart)
			throw new Error("Dart SDK not available");
		const dartExecutable = path.join(data.sdks.dart, dartVMPath);

		return safeToolSpawn(folder, dartExecutable, args);
	}
}

class PublicFeaturesImpl implements PublicFeatures {
	private readonly codeLensImpl = new PublicCodeLensImpl();

	public get codeLens(): PublicCodeLens {
		return this.codeLensImpl;
	}
}

class PublicCodeLensImpl implements PublicCodeLens {
	public suppress(projectFolders: vs.Uri[], options: PublicCodeLensSuppressOptions): vs.Disposable {
		return data.codeLensSuppressions.addOverride(projectFolders, options);
	}
}
