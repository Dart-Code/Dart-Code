// This comment is extracted by the test and compared to a text representation
// built from the tree provider in the test. It must be maintained to match
// the results from the tests below.
// == EXPECTED RESULTS ==
// MyItem (class.svg)
//     build [(BuildContext context) → Widget] (method.svg)
//         RepaintBoundary (widget.svg)
//             RawMaterialButton (widget.svg)
//                 Column (widget.svg)
//                     Padding (widget.svg)
//                         Icon [Icons.ac_unit] (widget.svg)
//                     SizedBox (widget.svg)
//                     Container (widget.svg)
//                         Text ["Air Conditioning"] (widget.svg)
// MyItemsPage (class.svg)
//     build [(BuildContext context) → Widget] (method.svg)
//         SingleChildScrollView (widget.svg)
//             LayoutBuilder (widget.svg)
//                 RepaintBoundary (widget.svg)
//                     Column (widget.svg)
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
