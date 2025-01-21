@echo off

REM This script takes two inputs:
REM
REM 1. The first argument is the exit code to return
REM 2. The "DB_TEST_DART_PATH" env variable is the SDK path to print as output

if defined DC_TEST_DART_PATH echo %DC_TEST_DART_PATH%
exit /b %~1
