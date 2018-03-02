var path = require('path');
var childProcess = require('child_process');

const env = Object.create(process.env);
const args = ['node_modules/vscode/bin/test'];

function runTests(testFolder, workspaceFolder) {
	env.CODE_TESTS_WORKSPACE = path.join(process.cwd(), 'test', 'test_projects', workspaceFolder);
	env.CODE_TESTS_PATH = path.join(process.cwd(), 'out', 'test', testFolder);
	const res = childProcess.spawnSync('node', args, { env: env, stdio: 'pipe', cwd: process.cwd() });
	if (res.error)
		throw error;
	if (res.output)
		res.output.forEach(l => console.log((l || "").toString()));
}

runTests('general', 'hello_world');
runTests('flutter', 'flutter_hello_world');
