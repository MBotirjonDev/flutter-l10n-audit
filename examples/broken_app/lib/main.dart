import 'package:flutter/material.dart';
import 'l10n/app_localizations.dart';

class CartScreen extends StatelessWidget {
  const CartScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.appTitle)),
      body: Column(
        children: [
          Text(l10n.welcome('Botirjon')),
          Text(l10n.cartItems(3)),
          const Text('Free delivery over 200 000 so\'m'),
          TextField(decoration: InputDecoration(hintText: 'Promo code')),
          Image.asset('assets/images/banner.png'),
        ],
      ),
      floatingActionButton: FloatingActionButton(
        tooltip: 'Go to checkout',
        onPressed: () {},
        child: Text(l10n.checkout),
      ),
    );
  }
}
