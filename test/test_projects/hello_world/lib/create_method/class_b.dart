import 'class_a.dart';

class ClassB {
  ClassB() {
    var classA = new ClassA();
    classA.createNonExistentMethod();
  }
}
