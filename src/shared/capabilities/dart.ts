import { versionIsAtLeast } from "../../shared/utils";

export class DartCapabilities {
	public static get empty() { return new DartCapabilities("0.0.0"); }

	public version: string;

	constructor(dartVersion: string) {
		this.version = dartVersion;
	}

	// Support for Dart prior to 3.1 is deprecated as of Aug 2025.
	// https://medium.com/flutter/whats-new-in-flutter-3-35-c58ef72e3766#:~:text=Deprecated%20IDE%20support%20for%20older%20Flutter%20SDKs
	get isUnsupportedNow() { return !versionIsAtLeast(this.version, "3.1.0"); }

	get isUnsupportedSoon() { return false; }

	get needsNoExampleForPubGet() { return versionIsAtLeast(this.version, "3.1.0"); }
	get omitsClassNameForConstructors() { return versionIsAtLeast(this.version, "3.8.0-0"); }
	get omitsVoidForSetters() { return versionIsAtLeast(this.version, "3.3.0-0"); }
	// TODO(dantup): Fix this when it's clearer what augmentations will look like.
	get supportsAugmentations() { return versionIsAtLeast(this.version, "9.9.0-0"); }
	get supportsGoToImports() { return versionIsAtLeast(this.version, "3.7.0-0"); }
	get supportsFlutterSidebar() { return versionIsAtLeast(this.version, "3.2.0-201"); }
	get requiresDevToolsEmbedFlag() { return !versionIsAtLeast(this.version, "3.7.0-0"); }
	get supportsDevToolsDtdExposedUri() { return versionIsAtLeast(this.version, "3.6.0-255"); }
	get supportsMacroGeneratedFiles() { return versionIsAtLeast(this.version, "3.5.0-0"); }
	get supportsFormatSpecifiers() { return versionIsAtLeast(this.version, "3.0.0-0"); }
	get supportsDevToolsVsCodeExtensions() { return versionIsAtLeast(this.version, "3.3.0-247"); }
	get supportsDevToolsDtdSidebar() { return versionIsAtLeast(this.version, "3.6.0-160"); }
	get supportsDevToolsPropertyEditor() { return versionIsAtLeast(this.version, "3.8.0-171.2"); }
	get supportsLspOverDtd() { return versionIsAtLeast(this.version, "3.8.0-0"); }
	get supportsDtdRegisterVmService() { return versionIsAtLeast(this.version, "3.9.0-0"); }
	get supportsObservatory() { return !versionIsAtLeast(this.version, "3.9.0-0"); }
	get supportsMcpServer() { return versionIsAtLeast(this.version, "3.9.0-163"); } // https://github.com/dart-lang/ai/pull/206#issuecomment-3020314522
	get supportsMcpServerLogFile() { return versionIsAtLeast(this.version, "3.9.0-303"); }
	get mcpServerRequiresExperimentalFlag() { return !versionIsAtLeast(this.version, "3.9.0-293"); }

	// https://github.com/dart-lang/ai/pull/253
	// https://github.com/dart-lang/sdk/commit/d90b10c1b167663b9b51adc274ea0fdb18ba5856
	get supportsMcpServerExcludeTool() { return versionIsAtLeast(this.version, "3.10.0-69"); }

	/**
	 * Whether this version of the SDK supports DTD. This should be checked only for
	 * spawning DTD and not whether it's available within the extension.
	 */
	get supportsToolingDaemon() { return versionIsAtLeast(this.version, "3.4.0-139"); }
	// TODO: Update these (along with Flutter) when supported.
	get webSupportsHotReload() { return false; }
	get workspaceSymbolSearchUsesFuzzy() { return versionIsAtLeast(this.version, "3.1.0"); }

	// This seems like a Pub bug.. skip tests for this version.
	// https://github.com/dart-lang/pub/issues/4588
	get hasPackageConfigTimestampIssue() { return versionIsAtLeast(this.version, "3.7.0") && !versionIsAtLeast(this.version, "3.9.0"); }

	// https://github.com/Dart-Code/Dart-Code/issues/5652
	get hasOverrideCompletionIssue() { return !versionIsAtLeast(this.version, "3.10.0-205"); }
}
