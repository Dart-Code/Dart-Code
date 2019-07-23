import 'package:flutter/material.dart';
import 'package:path/path.dart' as path;

main() async {
  print(path.current);
  print(path.Style.platform);

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
