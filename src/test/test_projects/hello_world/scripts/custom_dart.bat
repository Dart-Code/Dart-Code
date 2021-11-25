if not exist "%~dp0\has_run" mkdir "%~dp0\has_run"
echo %* > "%~dp0\has_run\dart"
dart %*
