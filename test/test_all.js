var path = require('path');
var childProcess = require('child_process');

const env = Object.create(process.env);
const args = ['node_modules/vscode/bin/test'].concat(process.argv);

function runTests(testFolder, workspaceFolder) {
	env.CODE_TESTS_WORKSPACE = path.join(process.cwd(), 'test', 'test_projects', workspaceFolder);
	env.CODE_TESTS_PATH = path.join(process.cwd(), 'out', 'test', testFolder);
	childProcess.execFileSync('node', args, { env: env, stdio: 'inherit' });
}

runTests('general', 'hello_world');
runTests('flutter', 'flutter_hello_world');
