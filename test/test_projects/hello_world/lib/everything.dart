import 'dart:async';

import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';
import 'package:protobuf/protobuf.dart';

// Before blank line

// After blank line

const foo = "foo";

/// This is my class.
class MyClass {
  /// This is my num field.
  num myNumField;

  /// This is my num getter.
  num get myNumGetter => 1;

  /// This is my num setter.
  set myNumSetter(num value) {}

  /// This is my HTTP Client from another package.
  http.Client myHttpClient;

  /// This is a future string from an SDK library.
  Future<String> myFutureString;

  /// This is my class constructor.
  MyClass();

  /// This is my class named constructor.
  MyClass.myNamed();

  /// This is my void returning method.
  void myVoidReturningMethod() {}

  /// This is my string returning method.
  String myStringReturningMethod() {
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
  var a = new MyClass();
  var b = new MyClass.myNamed();
  // Force some references to things used in tests to ensure the analyzer
  // scans them.
  var c = new IOClient();
  var d = new ProtobufEnum(1, '');
  print(c);
  print(d);
  print(a.myNumField);
  print(a.myNumGetter);
  a.myNumSetter = 1;
  print(b.myStringReturningMethod());
  b.myVoidReturningMethod();
  b.methodTakingString("Hello");
  b.methodTakingString("World!");
  b.methodTakingFunction((s) => print(s));
}

enum Theme { Light, Dark }
