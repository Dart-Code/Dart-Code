#!/usr/bin/env bash
mkdir -p `dirname "$0"`/has_run
echo "$@" > `dirname "$0"`/has_run/web
dart pub global run webdev daemon "$@"
