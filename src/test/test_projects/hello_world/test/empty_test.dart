import 'package:test/test.dart';
import 'package:test_reflective_loader/test_reflective_loader.dart';

void main() {
  defineReflectiveSuite(() {
    defineReflectiveTests(MyTest);
  });

  group('group1', () {
    test('test1', () {
      expect(1, 1);
    });
  });
}

@reflectiveTest
class MyTest {
  void test_reflected() {
    expect(1, 1);
  }
}
