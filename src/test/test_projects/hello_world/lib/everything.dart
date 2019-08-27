import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:protobuf/protobuf.dart';

// Before blank line

// After blank line

const foo = "foo";

/// This is my class.
class MyTestClass {
  /// This is my num field.
  num myTestNumField;

  /// This is my num getter.
  num get myTestNumGetter => 1;

  /// This is my num setter.
  set myTestNumSetter(num value) {}

  /// This is my HTTP Client from another package.
  http.Client myTestHttpClient;

  /// This is a future string from an SDK library.
  Future<String> myTestFutureString;

  /// This is my class constructor.
  MyTestClass();

  /// This is my class named constructor.
  MyTestClass.myTestNamed();

  /// This is my void returning method.
  void myTestVoidReturningMethod() {}

  /// This is my string returning method.
  String myTestStringReturningMethod() {
    final str = "str";
    return str;
  }

  /// This is my method taking a string.
  void methodTakingString(String a) {}

  /// This is my method taking a function.
  void methodTakingFunction(void Function(String) myFunc) {}

  /// This is my method taking arguments and returning a value.
  int methodWithArgsAndReturnValue(int i) {
    return i;
  }
}

@deprecated
void doSomeStuff() {
  var a = MyTestClass();
  var b = MyTestClass.myTestNamed();
  // Force some references to things used in tests to ensure the analyzer
  // scans them.
  var c = IOClient();
  var d = ProtobufEnum(1, '');
  print(c);
  print(d);
  print(a.myTestNumField);
  print(a.myTestNumGetter);
  a.myTestNumSetter = 1;
  print(b.myTestStringReturningMethod());
  b.myTestVoidReturningMethod();
  b.methodTakingString("Hello");
  b.methodTakingString("World!");
  b.methodTakingFunction((s) => print(s));
}

enum Theme { Light, Dark }
