import { strict as assert } from "assert";
import { simplifyVersion } from "../../../shared/utils/workspace";

describe("simplifyVersion", () => {
	it("handles simple x.y.z versions", () => {
		assert.equal(simplifyVersion("1.2.3"), "1.2");
		assert.equal(simplifyVersion("0.0.3"), "0.0");
		assert.equal(simplifyVersion("999.998.997"), "999.998");
	});

	it("handles simple x.y versions", () => {
		assert.equal(simplifyVersion("1.2"), "1.2");
		assert.equal(simplifyVersion("0.0"), "0.0");
		assert.equal(simplifyVersion("999.998"), "999.998");
	});

	it("handles simple x.y.z-pre versions", () => {
		assert.equal(simplifyVersion("1.2.3-pre"), "1.2-pre");
		assert.equal(simplifyVersion("0.0.3-pre"), "0.0-pre");
		assert.equal(simplifyVersion("999.998.997-pre"), "999.998-pre");
	});

	it("handles simple x.y-pre versions", () => {
		assert.equal(simplifyVersion("1.2-pre"), "1.2-pre");
		assert.equal(simplifyVersion("0.0-pre"), "0.0-pre");
		assert.equal(simplifyVersion("999.998-pre"), "999.998-pre");
	});

	it("handles simple x.y.z-pre.foo versions", () => {
		assert.equal(simplifyVersion("1.2.3-pre.foo"), "1.2-pre");
		assert.equal(simplifyVersion("0.0.3-pre.foo"), "0.0-pre");
		assert.equal(simplifyVersion("999.998.997-pre.foo"), "999.998-pre");
	});

	it("handles simple x.y-pre.foo versions", () => {
		assert.equal(simplifyVersion("1.2-pre.foo"), "1.2-pre");
		assert.equal(simplifyVersion("0.0-pre.foo"), "0.0-pre");
		assert.equal(simplifyVersion("999.998-pre.foo"), "999.998-pre");
	});

	it("handles non-strings", () => {
		assert.equal(simplifyVersion(1), undefined);
		assert.equal(simplifyVersion(null), undefined);
		assert.equal(simplifyVersion(undefined), undefined);
		assert.equal(simplifyVersion(true), undefined);
		assert.equal(simplifyVersion({}), undefined);
	});

	it("handles other non-standard input", () => {
		assert.equal(simplifyVersion("1"), "1");
		assert.equal(simplifyVersion("1-foo"), "1-foo");
		assert.equal(simplifyVersion("TEST"), "TEST");
		assert.equal(simplifyVersion(""), "");
	});
});
