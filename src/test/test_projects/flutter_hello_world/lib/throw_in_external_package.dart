import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

main() async {
  final resp = await http.read("not://a.valid@url");
  print(resp);

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
