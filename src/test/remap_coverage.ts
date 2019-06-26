// tslint:disable: no-var-requires
import * as fs from "fs";
import * as path from "path";
const loadCoverage = require("remap-istanbul/lib/loadCoverage");
const remap = require("remap-istanbul/lib/remap");
const writeReport = require("remap-istanbul/lib/writeReport");

const files = fs.readdirSync("../../.nyc_output")
	.filter((item) => item.endsWith(".json"));

for (const filename of files) {
	const fullPath = `../../.nyc_output/${filename}`;
	const coverage = loadCoverage(fullPath);
	const collector = remap(coverage, {
		mapFileName: path.resolve,
	});
	writeReport(collector, "json", {}, fullPath);
}
