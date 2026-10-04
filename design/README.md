# Makiety ekranów telefonu (390×844)

Każdy plik `.html` to jeden ekran. Wygląd jest zapisany w stylach inline, więc
wartości można czytać wprost z plików. `tokens.css` zbiera je w jednym miejscu.

Pliki pochodzą z edytora makiet: znacznik `<x-dc>`, skrypt `support.js` i wstawki
`{{...}}` należą do edytora i nie przechodzą do aplikacji. Otwarte bezpośrednio
w przeglądarce nie wyrenderują się, służą do czytania. Podgląd wizualny dają
pliki PNG, jeśli są w tym folderze.

| Plik | Ekran |
| --- | --- |
| Aktywacja-start.html | Wejście z kodu QR, przycisk „Aktywuj dostęp” |
| Aktywacja-sukces.html | „Telefon został dodany”, wybór domyślnego piętra, nazwa telefonu |
| Aktywacja-blad.html | Kod wygasły, nieprawidłowy albo wykorzystany (teksty w skrypcie na dole pliku) |
| Ekran-glowny.html | Wyświetlacz, wybór piętra, suwak osób, „Wezwij windę”, szyb po prawej |
| Wezwanie-jedzie.html | „Winda jedzie do Ciebie”, ETA, zmiana liczby osób, anulowanie |
| Wezwanie-oczekiwanie.html | „Oczekiwanie na miejsce”, wyświetlacz bursztynowy |
| Wezwanie-przyjazd.html | „Winda przyjechała na Twoje piętro”, wyświetlacz zielony, drzwi otwarte |
| Brak-polaczenia.html | Ostatnio znana pozycja, odliczanie wstrzymane |
| Awaria.html | „Winda niedostępna”, zablokowane wezwanie |
| Ustawienia.html | Domyślne piętro, nazwa telefonu, przypisany budynek |

Nazwa budynku „Budynek demonstracyjny” i „[adres budynku]” to placeholdery.
