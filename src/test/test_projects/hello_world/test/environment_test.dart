import 'dart:io';

import "package:test/test.dart";

void main() {
  test("Environment variable LAUNCH_ENV_VAR was set", () {
    expect(Platform.environment['LAUNCH_ENV_VAR'], isNotNull);
    print('LAUNCH_ENV_VAR=${Platform.environment['LAUNCH_ENV_VAR']}');
  });
}
