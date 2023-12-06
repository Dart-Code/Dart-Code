import 'package:flutter/material.dart';

// ignore: unused_import
import 'package:flutter_hello_world/navigate_to.dart';

void main() => runApp(MyApp());

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    maybePostNavigationEvent();

    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: Text('Hello!'),
    );
  }
}
