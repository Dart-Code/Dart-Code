var path = require('path');

process.env.CODE_TESTS_WORKSPACE = path.join(process.cwd(), 'test', 'test_projects', 'hello_world');
require('vscode/bin/test');
