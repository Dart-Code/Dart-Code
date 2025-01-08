import { versionIsAtLeast } from "../../shared/utils";
import { isWin } from "../constants";

export class DartCapabilities {
	public static get empty() { return new DartCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	get canDefaultLsp() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	get canDefaultSdkDaps() {
		// For Windows, we need a higher version.
		// https://github.com/Dart-Code/Dart-Code/issues/4149
		// https://github.com/dart-lang/sdk/commit/1b9adcb502c5e4ec1bc5ce8e8b0387db25216833
		if (isWin)
			return versionIsAtLeast(this.version, "2.19.0-196");
		else
			return versionIsAtLeast(this.version, "2.18.0-0");
	}
	get hasLspInsertTextModeSupport() { return versionIsAtLeast(this.version, "2.13.0-0"); }

	// No SDKs are currently unsupported.
	get isUnsupportedNow() { return false; }

	// SDKs older than 3.0 are deprecated as of the release of Dart 3.6.
	// https://groups.google.com/g/flutter-announce/c/JQHzM3FbBGI
	get isUnsupportedSoon() { return !versionIsAtLeast(this.version, "3.0.0"); }

	get supportsSnippetTextEdits() { return versionIsAtLeast(this.version, "2.13.0-150"); }
	get supportsRefactorValidate() { return versionIsAtLeast(this.version, "2.17.0"); }
	get supportsWriteServiceInfo() { return versionIsAtLeast(this.version, "2.7.1"); }
	get supportsDartCreate() { return versionIsAtLeast(this.version, "2.10.0"); }
	get supportsDebugInternalLibraries() { return versionIsAtLeast(this.version, "2.9.0-a"); }
	get supportsLanguageServerCommand() { return versionIsAtLeast(this.version, "2.14.4"); }
	get supportsNoServeDevTools() { return versionIsAtLeast(this.version, "2.14.0-172.0"); }
	get supportsPubUpgradeMajorVersions() { return versionIsAtLeast(this.version, "2.12.0"); }
	get needsNoExampleForPubGet() { return versionIsAtLeast(this.version, "3.1.0"); }
	get omitsVoidForSetters() { return versionIsAtLeast(this.version, "3.3.0-0"); }
	get supportsAugmentations() { return versionIsAtLeast(this.version, "3.7.0-0"); }
	get supportsPubOutdated() { return versionIsAtLeast(this.version, "2.8.0-a"); }
	get supportsGoToImports() { return versionIsAtLeast(this.version, "3.7.0-0"); }
	get supportsFlutterSidebar() { return versionIsAtLeast(this.version, "3.2.0-201"); }
	get supportsPubDepsJson() { return versionIsAtLeast(this.version, "2.14.0-0"); }
	get supportsPubAddMultiple() { return versionIsAtLeast(this.version, "2.17.0"); }
	get supportsDartPub() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	get supportsDartRunForPub() { return versionIsAtLeast(this.version, "2.16.0-0"); }
	get supportsDartDoc() { return versionIsAtLeast(this.version, "2.16.0"); }
	get supportsDartDevTools() { return versionIsAtLeast(this.version, "2.15.0"); }
	get supportsDartDevToolsPathUrls() { return versionIsAtLeast(this.version, "2.18.0-0"); }
	get requiresDevToolsEmbedFlag() { return !versionIsAtLeast(this.version, "3.7.0-0"); }
	get supportsDevToolsDtdExposedUri() { return versionIsAtLeast(this.version, "3.6.0-255"); }
	get supportsDartRunTest() { return versionIsAtLeast(this.version, "2.12.0-0"); }
	get supportsLegacyAnalyzerProtocol() { return !versionIsAtLeast(this.version, "3.3.0"); }
	get supportsMacroGeneratedFiles() { return versionIsAtLeast(this.version, "3.5.0-0"); }
	get supportsMoveTopLevelToFile() { return versionIsAtLeast(this.version, "2.19.0-283"); }
	get supportsNonFileSchemeWorkspaces() { return versionIsAtLeast(this.version, "2.13.0-28"); }
	get supportsCommandParameterSupportedKinds() { return versionIsAtLeast(this.version, "2.19.0-283"); }
	get supportsServerSnippets() { return versionIsAtLeast(this.version, "2.17.0-258"); }
	get supportsFormatSpecifiers() { return versionIsAtLeast(this.version, "3.0.0-0"); }
	get supportsSdkDap() { return versionIsAtLeast(this.version, "2.17.0-0"); }
	get supportsShowTodoArray() { return versionIsAtLeast(this.version, "2.16.0-0"); }
	get sdkDapProvidesExceptionText() { return versionIsAtLeast(this.version, "2.18.0-265"); }
	get supportsSetIsolatePauseModeForWeb() { return versionIsAtLeast(this.version, "2.19.0"); }
	get supportsDevToolsVsCodeExtensions() { return versionIsAtLeast(this.version, "3.3.0-247"); }
	get supportsDevToolsDtdSidebar() { return versionIsAtLeast(this.version, "3.6.0-160"); }
	/**
	 * Whether this version of the SDK supports DTD. This should be checked only for
	 * spawning DTD and not whether it's available within the extension.
	 */
	get supportsToolingDaemon() { return versionIsAtLeast(this.version, "3.4.0-139"); }
	// TODO: Update these (along with Flutter) when supported.
	get webSupportsHotReload() { return false; }
	get workspaceSymbolSearchUsesFuzzy() { return versionIsAtLeast(this.version, "3.1.0"); }
}
