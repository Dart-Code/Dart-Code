// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from teh tests below.
// == EXPECTED RESULTS ==
// MyItem (class.svg)
//     build(BuildContext context) → Widget (method.svg)
//         RepaintBoundary (flutter_widget.svg)
//             RawMaterialButton (flutter_widget.svg)
//                 Column (flutter_widget.svg)
//                     Padding (flutter_widget.svg)
//                         Icon (flutter_widget.svg)
//                     SizedBox (flutter_widget.svg)
//                     Container (flutter_widget.svg)
//                         Text (flutter_widget.svg)
// MyItemsPage (class.svg)
//     build(BuildContext context) → Widget (method.svg)
//         SingleChildScrollView (flutter_widget.svg)
//             LayoutBuilder (flutter_widget.svg)
//                 RepaintBoundary (flutter_widget.svg)
//                     Column (flutter_widget.svg)
// == /EXPECTED RESULTS ==

import 'package:flutter/material.dart';

class MyItem extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return RepaintBoundary(
      child: RawMaterialButton(
        onPressed: () {},
        child: Column(
          children: <Widget>[
            Padding(
              padding: const EdgeInsets.all(6.0),
              child: Icon(Icons.ac_unit),
            ),
            const SizedBox(height: 10.0),
            Container(
              child: Text("Air Conditioning"),
            ),
          ],
        ),
      ),
    );
  }
}

class MyItemsPage extends StatelessWidget {
  @override
  Widget build(BuildContext context) => SingleChildScrollView(
        child: LayoutBuilder(
          builder: (BuildContext context, BoxConstraints constraints) {
            return RepaintBoundary(
              child: Column(
                children: List<Widget>.generate(100, (int rowIndex) {
                  return Row(
                    children: List<Widget>.generate(
                      100,
                      (int columnIndex) => Container(),
                    ),
                  );
                }),
              ),
            );
          },
        ),
      );
}
