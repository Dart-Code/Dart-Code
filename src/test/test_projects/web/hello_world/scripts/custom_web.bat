if not exist "%~dp0\has_run" mkdir "%~dp0\has_run"
echo %* > "%~dp0\has_run\web"
dart pub global run webdev daemon %*
