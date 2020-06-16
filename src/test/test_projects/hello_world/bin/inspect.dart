import 'dart:async';
import 'dart:developer';

main() async {
  final people = [
    Person("Danny"),
    Person("Fred"),
  ];

  inspect(people);

  await Future.delayed(Duration(seconds: 30));
}

class Person {
  final String name;
  Person(this.name);
}
