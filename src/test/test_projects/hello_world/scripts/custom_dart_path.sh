#!/usr/bin/env bash
if [[ -n $DC_TEST_DART_PATH ]]; then
  echo $DC_TEST_DART_PATH
fi
exit $1
