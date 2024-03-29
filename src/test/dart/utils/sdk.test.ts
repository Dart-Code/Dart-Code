import { strict as assert } from "assert";
import { pubspecContentReferencesFlutter } from "../../../shared/utils/fs";

describe("pubspecContentReferencesFlutterSdk", () => {
	it("returns false for non-Flutter pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: foo
version: 1.2.3

dependencies:
  not_a_flutter_dep:
		`);
		assert.equal(isFlutter, false);
	});

	it("returns true for standard Flutter pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with extra whitespace", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk:     flutter      #
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with no whitespace", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk:flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with double quotes", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: "flutter"
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for Flutter pubspec.yaml with single quotes", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  flutter:
    sdk: 'flutter'
		`);
		assert.equal(isFlutter, true);
	});

	it("returns false if the dependency is commented out", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

dev_dependencies:
  # flutter:
  #   sdk: flutter
  lints: ^2.0.0
		`);
		assert.equal(isFlutter, false);
	});

	it("returns true for only sky_engine dev_dependency in pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dependencies:
  sky_engine:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});

	it("returns true for only flutter_test dev_dependency in pubspec.yaml", () => {
		const isFlutter = pubspecContentReferencesFlutter(`
name: my_project
description: A new Flutter project.
publish_to: 'none'
version: 1.0.0+1

environment:
  sdk: ">=2.14.0 <3.0.0"

dev_dependencies:
  flutter_test:
    sdk: flutter
		`);
		assert.equal(isFlutter, true);
	});
});
