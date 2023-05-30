import { strict as assert } from "assert";
import { simplifyVersion } from "../../../shared/utils/workspace";

describe("simplifyVersion", () => {
	it("handles simple x.y.z versions", () => {
		assert.equal(simplifyVersion("1.2.3"), "1.2.x");
		assert.equal(simplifyVersion("0.0.3"), "0.0.x");
		assert.equal(simplifyVersion("999.998.997"), "999.998.x");
	});

	it("handles simple x.y versions", () => {
		assert.equal(simplifyVersion("1.2"), "1.2.x");
		assert.equal(simplifyVersion("0.0"), "0.0.x");
		assert.equal(simplifyVersion("999.998"), "999.998.x");
	});

	it("handles simple x.y.z with known pre-release kinds", () => {
		for (const knownName of ["beta", "alpha", "dev", "edge"]) {
			assert.equal(simplifyVersion(`3.1.0-63.1.${knownName}`), `3.1.x-${knownName}`);
			assert.equal(simplifyVersion(`3.1.0-${knownName}.1.2`), `3.1.x-${knownName}`);
			assert.equal(simplifyVersion(`3.1.0-1.${knownName}.2`), `3.1.x-${knownName}`);
		}
	});

	it("handles simple x.y with known pre-release kinds", () => {
		for (const knownName of ["beta", "alpha", "dev", "edge"]) {
			assert.equal(simplifyVersion(`3.0-63.1.${knownName}`), `3.0.x-${knownName}`);
			assert.equal(simplifyVersion(`3.0-${knownName}.1.2`), `3.0.x-${knownName}`);
			assert.equal(simplifyVersion(`3.0-1.${knownName}.2`), `3.0.x-${knownName}`);
		}
	});

	it("handles simple x.y.z with unknown pre-release kinds", () => {
		assert.equal(simplifyVersion("3.1.0-63.1.apple"), "3.1.x-pre");
		assert.equal(simplifyVersion("3.1.0-apple.pear.123"), "3.1.x-pre");
		assert.equal(simplifyVersion("3.1.0-123.apple.123"), "3.1.x-pre");
	});

	it("handles simple x.y with unknown pre-release kinds", () => {
		assert.equal(simplifyVersion("3.0-63.1.apple"), "3.0.x-pre");
		assert.equal(simplifyVersion("3.0-apple.pear.123"), "3.0.x-pre");
		assert.equal(simplifyVersion("3.0-123.apple.123"), "3.0.x-pre");
	});

	it("handles non-strings", () => {
		assert.equal(simplifyVersion(1), undefined);
		assert.equal(simplifyVersion(null), undefined);
		assert.equal(simplifyVersion(undefined), undefined);
		assert.equal(simplifyVersion(true), undefined);
		assert.equal(simplifyVersion({}), undefined);
	});

	it("handles other non-standard input", () => {
		assert.equal(simplifyVersion("1"), "1.x.x");
		assert.equal(simplifyVersion("1-foo"), "1.x.x-pre");
		assert.equal(simplifyVersion("TEST"), "TEST.x.x");
		assert.equal(simplifyVersion(""), "0.x.x");
	});
});
