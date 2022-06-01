import 'package:flutter/material.dart';

void main() => runApp(MyBrokenApp());

class MyBrokenApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: MyBrokenHomePage(),
    );
  }
}

class MyBrokenHomePage extends StatelessWidget {
  MyBrokenHomePage({super.key});

  @override
  Widget build(BuildContext context) {
    _throwAnException();
    return Text("test");
  }

  void _throwAnException() {
    throw Exception("Oops");
  }
}
