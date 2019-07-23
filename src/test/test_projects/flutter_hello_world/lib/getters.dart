import 'package:flutter/material.dart';

class Person {
  String get kind => "Person";
  String get throws => throw "Oops!";
}

class Danny extends Person {
  String get name => "Danny";
}

main() {
  var danny = Danny();
  print(danny.name); // BREAKPOINT1

  runApp(MyApp());
}

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: MyHomePage(),
    );
  }
}

class MyHomePage extends StatelessWidget {
  MyHomePage({Key key}) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Text(
      'Hello, world!',
      textDirection: TextDirection.ltr,
    );
  }
}
