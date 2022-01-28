import 'dart:io';

import "package:test/test.dart";

void main() {
  test("Environment variable LAUNCH_ENV_VAR was set to 'true'", () {
    expect(Platform.environment['LAUNCH_ENV_VAR'], equals('true'));
  });
}
