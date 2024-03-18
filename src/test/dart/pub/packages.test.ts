import { strict as assert } from "assert";
import * as fs from "fs";
import * as path from "path";
import * as vs from "vscode";
import { Sdks } from "../../../shared/interfaces";
import { nullLogger } from "../../../shared/logging";
import { getPubPackageStatus } from "../../../shared/vscode/pub";
import { activate, delay, getRandomTempFolder } from "../../helpers";

describe("pub package status", () => {
	let tempProjectPath: string;
	let tempProjectUri: vs.Uri;

	function sdkVersion(v: string): Sdks {
		return {
			dartSdkIsFromFlutter: false,
			dartVersion: v,
			isPreReleaseSdk: false,
		};
	}

	const sdks123 = sdkVersion("1.2.3");

	beforeEach("activate", () => activate());
	beforeEach("set up project", () => {
		tempProjectPath = getRandomTempFolder();
		tempProjectUri = vs.Uri.file(tempProjectPath);
	});

	function createPubspec() {
		const pubspecPath = path.join(tempProjectPath, "pubspec.yaml");
		fs.writeFileSync(pubspecPath, `
name: foo
version: 1.0.0

# We'll never
dependencies:
		`);
	}

	function createPubspecWithoutDependencies() {
		const pubspecPath = path.join(tempProjectPath, "pubspec.yaml");
		fs.writeFileSync(pubspecPath, "");
	}

	function createPackageConfig(pubGeneratorSdkVersion = sdks123.dartVersion) {
		const dartToolPath = path.join(tempProjectPath, ".dart_tool");
		fs.mkdirSync(dartToolPath, { recursive: true });
		const packageConfigPath = path.join(dartToolPath, "package_config.json");
		fs.writeFileSync(packageConfigPath, `{ "generatorVersion": "${pubGeneratorSdkVersion}" }`);
	}

	function expectGet(status: { probablyRequiresGet: true, probablyRequiresUpgrade: boolean } | undefined) {
		assert.equal(status?.probablyRequiresGet, true);
		assert.equal(status?.probablyRequiresUpgrade, false);
	}

	function expectUpgrade(status: { probablyRequiresGet: true, probablyRequiresUpgrade: boolean } | undefined) {
		assert.equal(status?.probablyRequiresGet, true);
		assert.equal(status?.probablyRequiresUpgrade, true);
	}

	it("missing pubspec returns undefined", async () => {
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		assert.equal(status, undefined);
	});

	it("pubspec without dependencies returns undefined", async () => {
		createPubspecWithoutDependencies();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		assert.equal(status, undefined);
	});

	it("pubspec but missing package_config returns GET", async () => {
		createPubspec();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("pubspec but stale package_config returns GET", async () => {
		createPackageConfig();
		await delay(1000);
		createPubspec();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("pubspec but fresh package_config returns GET", async () => {
		createPubspec();
		createPackageConfig();
		const status = getPubPackageStatus(sdks123, nullLogger, tempProjectUri);
		assert.equal(status, undefined);
	});

	it("upgraded SDK (major) returns UPGRADE", async () => {
		createPubspec();
		createPackageConfig("1.0.0");
		const status = getPubPackageStatus(sdkVersion("2.0.0"), nullLogger, tempProjectUri);
		expectUpgrade(status);
	});

	it("upgraded SDK (minor) returns UPGRADE", async () => {
		createPubspec();
		createPackageConfig("2.0.0");
		const status = getPubPackageStatus(sdkVersion("2.1.0"), nullLogger, tempProjectUri);
		expectUpgrade(status);
	});

	it("upgraded SDK (patch) returns undefined", async () => {
		createPubspec();
		createPackageConfig("2.1.1");
		const status = getPubPackageStatus(sdkVersion("2.1.0"), nullLogger, tempProjectUri);
		assert.equal(status, undefined);
	});

	it("downgraded SDK (patch) returns GET", async () => {
		createPubspec();
		createPackageConfig("2.0.0");
		const status = getPubPackageStatus(sdkVersion("1.0.0"), nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("downgraded SDK (minor) returns GET", async () => {
		createPubspec();
		createPackageConfig("2.1.0");
		const status = getPubPackageStatus(sdkVersion("2.0.0"), nullLogger, tempProjectUri);
		expectGet(status);
	});

	it("downgraded SDK (patch) returns undefined", async () => {
		createPubspec();
		createPackageConfig("2.1.0");
		const status = getPubPackageStatus(sdkVersion("2.1.1"), nullLogger, tempProjectUri);
		assert.equal(status, undefined);
	});
});
