/// This file contains sample cases of tests that fail to run as expected when
/// run by names and require running by line number.
///
/// Each test has its GitHub issue URL on the line above where the CodeLens
/// should be clicked. Clicking the CodeLens should run exactly one test (when
/// running by name, some will fail, and some will run too many).

import 'package:meta/meta.dart';
import 'package:test/test.dart';

void main() {
  const myVariable = 'myVariable';

  @isTest
  void customTest(String desc, void Function() body) =>
      test('$desc (extra text)', body);

  String groupDescription(String description) => description;

  // https://github.com/Dart-Code/Dart-Code/issues/4021
  group(groupDescription('group 1'), () {
    test('test 1', () {
      expect(1, 1);
    });
  });

  group('$myVariable', () {
    // https://github.com/Dart-Code/Dart-Code/issues/4150
    test('is $myVariable', () {
      expect(1, 1);
    });

    test('foo and is $myVariable', () {
      expect(1, 1);
    });
  });

  // https://github.com/Dart-Code/Dart-Code/issues/4168
  test(('test 1'), () => expect(1, equals(1)));

  // https://github.com/Dart-Code/Dart-Code/issues/4099
  customTest('test', () {
    expect(1, 1);
  });

  // https://github.com/Dart-Code/Dart-Code/issues/4250
  test('Start string $myVariable ' '  end string', () async {
    expect(true, true);
  });
}
