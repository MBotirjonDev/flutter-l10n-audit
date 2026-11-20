import 'package:flutter/material.dart';
import 'l10n/app_localizations.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: Column(children: [Text(l10n.welcome('Botirjon')), Text(l10n.cartItems(3))]),
    );
  }
}
