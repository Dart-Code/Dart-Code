// Before blank line

// After blank line

/// This is my class.
class MyClass {
  /// This is my num field.
  num myNumField;

  /// This is my num getter.
  num get myNumGetter => 1;

  /// This is my num setter.
  set myNumSetter(num value) {}

  /// This is my class constructor.
  MyClass();

  /// This is my class named constructor.
  MyClass.named();

  /// This is my void returning method.
  void myVoidReturningMethod() {}

  /// This is my string returning method.
  String myStringReturningMethod() {
    return "";
  }

  /// This is my method taking a string.
  void methodTakingString(String a) {}

  /// This is my method taking a function.
  void methodTakingFunction(int Function(String) myFunc) {}
}
