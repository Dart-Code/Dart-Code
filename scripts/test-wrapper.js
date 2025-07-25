#!/usr/bin/env node

// Test wrapper script that handles argument passing
const { execSync } = require('child_process');

// Get arguments passed to this script
const args = process.argv.slice(2);

// Set up environment
const env = { ...process.env };
if (args.length > 0) {
	env.DART_CODE_TEST_FILTER = JSON.stringify(args);
}

try {
	// Run the build and test chain
	execSync('npm run build && npm run build-tests && npm run instrument-dist && npm run instrument && npm run test-only && npm run report_lcov && npm run report_screen', {
		stdio: 'inherit',
		env: env,
		cwd: process.cwd()
	});
} catch (error) {
	process.exit(error.status || 1);
}