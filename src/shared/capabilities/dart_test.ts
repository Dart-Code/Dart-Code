import { versionIsAtLeast } from "../../shared/utils";

export class DartTestCapabilities {
	public static get empty() { return new DartTestCapabilities("0.0.0"); }

	public version: string;

	constructor(testVersion: string) {
		this.version = testVersion;
	}

	get supportsIgnoreTimeouts() { return versionIsAtLeast(this.version, "1.20.1"); }
	get supportsRunTestsByLine() { return versionIsAtLeast(this.version, "1.23.1"); }
	get supportsLcovCoverage() { return versionIsAtLeast(this.version, "1.27.0"); }
}

export class DartTestCapabilitiesFromHelpText extends DartTestCapabilities {
	constructor(private readonly helpText: string) {
		super("0.0.0"); // Default to nothing.
	}

	get supportsIgnoreTimeouts() {
		return this.helpText.includes("--ignore-timeouts");
	}
	get supportsRunTestsByLine() {
		// There's nothing in the help text that indicates whether running by line is supported, but
		// --compiler was added in 1.24 which is after 1.23.1 which is the version runByLine is gated on
		// above.
		return this.helpText.includes("--compiler");
	}
	get supportsLcovCoverage() {
		return this.helpText.includes("--coverage-path") && this.helpText.includes("--branch-coverage");
	}
}
