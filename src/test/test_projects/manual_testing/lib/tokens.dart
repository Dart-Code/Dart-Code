class lowercase {}

class UPPERCASE {}

class MyClass {
  void method1() => print('Called method1!');
  void Method2() => print('Called method2!');
  void get() => print('Called get()!');
  void set() => print('Called set()!');

  String? _foo;
  String? get foo => _foo;
  set foo(String? value) => _foo = value;
}

void main() async {
  var FOO = MyClass();
  FOO.method1();
  FOO.Method2();
  FOO.get();
  FOO.set();
  FOO.foo = FOO.foo;

  void Function() notNullableFunc = () {};
  void Function()? nullableFunc;

  notNullableFunc();
  nullableFunc!();

  var val = 'test' as dynamic;
  print('!$val世界!');

  final a = await null;
  if (a == null) {
    print(false);
    for (var i in []) {
      if (i == 0) {
        continue;
      }
      break;
    }
  } else {}

  try {
    assert(true == true);
  } on Exception {
    throw Exception('test');
  } catch (e) {
    rethrow;
  } finally {}

  switch (true) {
    case false:
      break;
    default:
  }

  while (1 == 2) {
    do {} while (false);
  }
}
