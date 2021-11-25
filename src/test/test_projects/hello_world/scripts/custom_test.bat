if not exist "%~dp0\has_run" mkdir "%~dp0\has_run"
echo %* > "%~dp0\has_run\dart_test"
dart run test:test %*
