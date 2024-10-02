import { strict as assert } from "assert";
import { URI } from "vscode-uri";
import { isWin } from "../../../shared/constants";
import { DocumentCache } from "../../../shared/utils/document_cache";

describe("DocumentCache", () => {
	it("non-file", () => {
		const cache = new DocumentCache<number>();
		const uri1 = URI.parse("http://example.org/one");
		const uri2 = URI.parse("http://example.org/ONE");

		cache.set(uri1, 1);
		cache.set(uri2, 2);

		assert.equal(cache.get(uri1), 1);
		assert.equal(cache.get(uri2), 2);
	});

	it("file (Windows)", () => {
		const cache = new DocumentCache<number>();
		const uri1 = URI.parse("file:///c:/foo");
		const uri2 = URI.parse("file:///d:/foo");

		cache.set(uri1, 1);
		cache.set(uri2, 2);

		assert.equal(cache.get(uri1), 1);
		assert.equal(cache.get(uri2), 2);
	});

	it("file (Windows) is case-insensitive and handles escaped colons", function () {
		if (!isWin) this.skip();

		const cache = new DocumentCache<number>();
		const uri1 = URI.parse("file:///C:/foo/bar/one");
		const uri2 = URI.parse("file:///C:/foo/bar/ONE");
		const uri3 = URI.parse("file:///c:/foo/bar/one");
		const uri4 = URI.parse("file:///c%3A/foo/bar/one");
		const uri5 = URI.parse("file:///C%3A/foo/bar/one");

		cache.set(uri1, 1);

		assert.equal(cache.has(uri1), true);
		assert.equal(cache.has(uri2), true);
		assert.equal(cache.has(uri3), true);
		assert.equal(cache.has(uri4), true);
		assert.equal(cache.has(uri5), true);
		assert.equal(cache.get(uri1), 1);
		assert.equal(cache.get(uri2), 1);
		assert.equal(cache.get(uri3), 1);
		assert.equal(cache.get(uri4), 1);
		assert.equal(cache.get(uri5), 1);

		cache.delete(uri5);

		assert.equal(cache.has(uri1), false);
		assert.equal(cache.has(uri2), false);
		assert.equal(cache.has(uri3), false);
		assert.equal(cache.has(uri4), false);
		assert.equal(cache.has(uri5), false);
		assert.equal(cache.get(uri1), undefined);
		assert.equal(cache.get(uri2), undefined);
		assert.equal(cache.get(uri3), undefined);
		assert.equal(cache.get(uri4), undefined);
		assert.equal(cache.get(uri5), undefined);
	});

	it("dart-macro+file (Windows) is case-insensitive and handles escaped colons", function () {
		if (!isWin) this.skip();

		const cache = new DocumentCache<number>();
		const uri1 = URI.parse("dart-macro+file:///C:/foo/bar/one");
		const uri2 = URI.parse("dart-macro+file:///C:/foo/bar/ONE");
		const uri3 = URI.parse("dart-macro+file:///c:/foo/bar/one");
		const uri4 = URI.parse("dart-macro+file:///c%3A/foo/bar/one");
		const uri5 = URI.parse("dart-macro+file:///C%3A/foo/bar/one");
		const uriNonMacro = uri1.with({ scheme: "file" });

		cache.set(uri1, 1);

		assert.equal(cache.has(uri1), true);
		assert.equal(cache.has(uri2), true);
		assert.equal(cache.has(uri3), true);
		assert.equal(cache.has(uri4), true);
		assert.equal(cache.has(uri5), true);
		assert.equal(cache.has(uriNonMacro), false);
		assert.equal(cache.get(uri1), 1);
		assert.equal(cache.get(uri2), 1);
		assert.equal(cache.get(uri3), 1);
		assert.equal(cache.get(uri4), 1);
		assert.equal(cache.get(uri5), 1);
		assert.equal(cache.get(uriNonMacro), undefined);

		cache.set(uriNonMacro, 2);
		cache.delete(uri5);

		assert.equal(cache.has(uri1), false);
		assert.equal(cache.has(uri2), false);
		assert.equal(cache.has(uri3), false);
		assert.equal(cache.has(uri4), false);
		assert.equal(cache.has(uri5), false);
		assert.equal(cache.has(uriNonMacro), true);
		assert.equal(cache.get(uri1), undefined);
		assert.equal(cache.get(uri2), undefined);
		assert.equal(cache.get(uri3), undefined);
		assert.equal(cache.get(uri4), undefined);
		assert.equal(cache.get(uri5), undefined);
		assert.equal(cache.get(uriNonMacro), 2);
	});

	it("file (non-Windows) is case-sensitive", function () {
		if (isWin) this.skip();

		const cache = new DocumentCache<number>();
		const uri1 = URI.parse("file:///foo/bar/one");
		const uri2 = URI.parse("file:///foo/bar/ONE");

		cache.set(uri1, 1);

		assert.equal(cache.has(uri1), true);
		assert.equal(cache.has(uri2), false);
		assert.equal(cache.get(uri1), 1);
		assert.equal(cache.get(uri2), undefined);

		cache.set(uri2, 2);
		cache.delete(uri1);

		assert.equal(cache.has(uri1), false);
		assert.equal(cache.has(uri2), true);
		assert.equal(cache.get(uri1), undefined);
		assert.equal(cache.get(uri2), 2);
	});

	it("dart-macro+file (non-Windows) is case-sensitive", function () {
		if (isWin) this.skip();

		const cache = new DocumentCache<number>();
		const uri1 = URI.parse("dart-macro+file:///foo/bar/one");
		const uri2 = URI.parse("file:///foo/bar/ONE");
		const uriNonMacro = uri1.with({ scheme: "file" });

		cache.set(uri1, 1);
		cache.set(uri2, 2);

		assert.equal(cache.has(uri1), true);
		assert.equal(cache.has(uri2), true);
		assert.equal(cache.has(uriNonMacro), false);
		assert.equal(cache.get(uri1), 1);
		assert.equal(cache.get(uri2), 2);
		assert.equal(cache.get(uriNonMacro), undefined);

		cache.set(uriNonMacro, 2);
		cache.delete(uri1);

		assert.equal(cache.has(uri1), false);
		assert.equal(cache.has(uri2), true);
		assert.equal(cache.has(uriNonMacro), true);
		assert.equal(cache.get(uri1), undefined);
		assert.equal(cache.get(uri2), 2);
		assert.equal(cache.get(uriNonMacro), 2);
	});
});
