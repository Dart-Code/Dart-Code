import { strict as assert } from "assert";
import { rewriteUrisForTestOutput } from "../../../shared/utils/test";

describe("test", () => {
	describe("rewriteUrisForTestOutput", () => {
		it("handles file:///foo/bar.dart:line:col", async () => {
			assert(
				rewriteUrisForTestOutput(`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file:///Users/danny/home_test.dart:11:35
				`),
				`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file:///Users/danny/home_test.dart#11,35
				`,
			);
		});
		it("handles file://c:/foo/bar.dart:line:col", async () => {
			assert(
				rewriteUrisForTestOutput(`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file://c:/Users/danny/home_test.dart:11:35
				`),
				`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file://c:/Users/danny/home_test.dart#11,35
				`,
			);
		});
		it("handles package:foo/bar.dart:line:col", async () => {
			assert(
				rewriteUrisForTestOutput(`
The relevant error-causing widget was:
  GalleryApp GalleryApp:package:foo/bar/home_test.dart:11:35
				`),
				`
The relevant error-causing widget was:
  GalleryApp GalleryApp:package:foo/bar/home_test.dart#11,35
				`,
			);
		});
		it("handles file:///foo/bar.dart line x", async () => {
			assert(
				rewriteUrisForTestOutput(`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file:///Users/danny/home_test.dart line 11
				`),
				`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file:///Users/danny/home_test.dart#11
				`,
			);
		});
		it("handles file://c:/foo/bar.dart line x", async () => {
			assert(
				rewriteUrisForTestOutput(`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file://c:/Users/danny/home_test.dart line 11
				`),
				`
The relevant error-causing widget was:
  GalleryApp GalleryApp:file://c:/Users/danny/home_test.dart#11
				`,
			);
		});
		it("handles package:foo/bar.dart line x", async () => {
			assert(
				rewriteUrisForTestOutput(`
The relevant error-causing widget was:
  GalleryApp GalleryApp:package:foo/bar/home_test.dart line 11
				`),
				`
The relevant error-causing widget was:
  GalleryApp GalleryApp:package:foo/bar/home_test.dart#11
				`,
			);
		});
	});
});
