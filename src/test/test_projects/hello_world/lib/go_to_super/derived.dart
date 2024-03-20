import 'super.dart';

class B extends A {
  @override
  void blah() {
    // blahB
  }
}

class C extends B {}

class D extends C {
  @override
  void blah() {
    // blahD
  }
}

class E extends D {
  @override
  void blah() {
    // blahE
  }
}
