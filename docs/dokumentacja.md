
# Dokumentacja aplikacji do wzywania windy

Opis działania i interfejsu użytkownika

Wersja 2.0 • 3 października 2026

## 1 Przeznaczenie aplikacji

Aplikacja umożliwia mieszkańcom budynku wezwanie windy na wybrane piętro i śledzenie jej położenia na wizualizacji bloku. Użytkownik określa liczbę osób oczekujących na przejazd, otrzymuje szacowany czas przyjazdu oraz informację, czy przewidywana dostępność kabiny pozwala zabrać całą grupę. Dzięki temu może lepiej zaplanować moment wyjścia z mieszkania i uniknąć oczekiwania na przejazd, w którym brakuje miejsca.

System łączy zgłoszenia z aplikacji z wezwaniami pochodzącymi z fizycznych przycisków na piętrach i w kabinie. Wszystkie zdarzenia wpływają na wspólną kolejkę oraz prognozę czasu przyjazdu. Osoby korzystające wyłącznie z przycisków również są uwzględniane w ruchu windy.

## Najważniejsze funkcje

| **Funkcja** | **Działanie** |
| --- | --- |
| **Aktywacja telefonu** | **Skanowanie kodu QR przypisuje dostęp aplikacji do właściwego budynku.** |
| **Wezwanie windy** | **Wybór piętra i liczby pasażerów, następnie potwierdzenie zgłoszenia.** |
| **Wizualizacja** | **Przekrój budynku pokazuje kabinę, piętra, kierunek i postoje.** |
| **Czas przyjazdu** | **Prognoza uwzględnia trasę, postoje i dostępność dla grupy.** |
| **Wspólna kolejka** | **Zgłoszenia mobilne i fizyczne korzystają z jednego modelu ruchu.** |
| **Obsługa grup** | **Zadeklarowana liczba osób służy do przydzielenia odpowiedniego przejazdu.** |

## Forma aplikacji

Interfejs ma postać responsywnej aplikacji webowej PWA dostępnej na telefonach i komputerach. Można uruchomić go w przeglądarce lub dodać do ekranu telefonu. Frontend i backend są osadzone w architekturze Cloudflare.

## Środowisko demonstracyjne

W wersji demonstracyjnej ruch windy, fizyczne przyciski oraz wejścia i wyjścia pasażerów odtwarza symulator. Przykładowy budynek obejmuje parter i piętra 1–10, a kabina ma skonfigurowaną pojemność 6 osób. Połączenie z realną windą odbywa się przez adapter jej sterownika; dane o obłożeniu wymagają odpowiedniej telemetrii. Opis funkcji nie stanowi potwierdzenia wdrożenia w rzeczywistym budynku.

# 2 Aktywacja telefonu kodem QR

## Pierwsze uruchomienie

Mieszkaniec otrzymuje od administratora kod QR do aktywacji dostępu. Skanuje go aparatem telefonu i otwiera stronę aplikacji. Ekran pokazuje nazwę i adres budynku oraz przycisk „Aktywuj dostęp”. Po zatwierdzeniu serwer weryfikuje kod i tworzy powiązanie nowej instalacji aplikacji z budynkiem. Użytkownik ustawia domyślne piętro i przechodzi do ekranu głównego.

Kod aktywacyjny zawiera odnośnik do aplikacji i jednorazowy token z okresem ważności. Po użyciu nie aktywuje kolejnego telefonu. Ogólnodostępny QR na tablicy może otwierać stronę budynku, ale sam odnośnik nie przyznaje uprawnień mieszkańca; aktywacja wymaga ważnego zaproszenia administratora.

## Identyfikacja urządzenia

Telefon jest rozpoznawany przez nadany podczas aktywacji losowy identyfikator instalacji oraz poświadczenie dostępu, a nie przez model telefonu. Dwa urządzenia tego samego modelu otrzymują różne identyfikatory. Opcjonalna nazwa, np. „Telefon Natalii”, służy wyłącznie do rozpoznania wpisu na liście urządzeń.

W PWA identyfikator odnosi się do konkretnego profilu przeglądarki lub instalacji aplikacji. Nie jest numerem IMEI ani niezmiennym identyfikatorem sprzętu. Usunięcie danych aplikacji, zmiana przeglądarki lub przeniesienie na nowy telefon może wymagać ponownej aktywacji. Sama nazwa modelu nie daje wiarygodnej identyfikacji telefonu.

## Uprawnienia i zarządzanie dostępem

Serwer sprawdza dostęp przy każdym wezwaniu. Aktywna instalacja jest przypisana do budynku; nie może zamawiać windy w innym bloku przez zmianę identyfikatora w żądaniu. Administrator widzi listę aktywowanych instalacji, datę aktywacji i nazwę nadaną przez mieszkańca. Może cofnąć dostęp, np. po utracie telefonu.

Poświadczenie sesji jest przechowywane w ciasteczku Secure i HttpOnly. Serwer przechowuje skrót tokenu aktywacyjnego, jego ważność i informację o wykorzystaniu. Żądania zmieniające stan podlegają weryfikacji pochodzenia i ochronie przed nadużyciami. Jeden telefon może mieć jedno aktywne wezwanie w danym budynku.

## Ekrany aktywacji

Ekran wejściowy zawiera nazwę budynku, krótki opis i przycisk aktywacji. Po sukcesie pojawia się „Telefon został dodany” oraz wybór domyślnego piętra. Kod nieprawidłowy, wygasły lub wykorzystany wyświetla konkretny komunikat i możliwość otrzymania nowego kodu od administratora. Stan błędu nie pozwala przejść do zamawiania windy.

# 3 Wezwanie windy i obsługa pasażerów

## Złożenie zgłoszenia

Na ekranie głównym użytkownik wybiera piętro odbioru oraz liczbę osób jadących razem. Wartość początkowa wynosi 1; przyciski minus i plus pozwalają ją zmienić. Dopuszczalny zakres wynika z konfiguracji kabiny. Jeśli instalacja rozróżnia kierunki wezwań, formularz zawiera także wybór „W górę” lub „W dół”. Piętro docelowe wybiera się w kabinie.

Po naciśnięciu „Wezwij windę” aplikacja przesyła piętro, liczebność grupy i unikalny identyfikator żądania. Dopiero akceptacja serwera zmienia ekran na oczekiwanie. Powtórne wysłanie tego samego żądania zwraca istniejące zgłoszenie i nie tworzy kolejnego postoju.

## Przydzielenie przejazdu dla grupy

System rozpatruje całą zadeklarowaną grupę. Porównuje jej wielkość z przewidywaną liczbą wolnych miejsc w kabinie na piętrze odbioru, po uwzględnieniu wcześniejszych zgłoszeń i znanych wyjść pasażerów. Gdy miejsca są dostępne, przypisuje grupę do tego przejazdu. Kilka grup może jechać razem, jeśli suma przydziałów mieści się w pojemności.

Jeżeli w najbliższym przejeździe brakuje miejsca, zgłoszenie pozostaje aktywne i czeka na kolejną możliwość zabrania całej grupy. Użytkownik widzi komunikat „Najbliższy przejazd nie pomieści Twojej grupy” oraz prognozę dla przejazdu, do którego może zostać przydzielony. ETA nie dotyczy wtedy pierwszego mijającego piętro przejazdu.

Zmiana liczby osób powoduje ponowne sprawdzenie miejsca i aktualizację prognozy. Grupa większa od pojemności kabiny otrzymuje komunikat o konieczności podziału na przejazdy. Deklaracja liczby osób wspiera planowanie; nie zastępuje fizycznego ograniczenia udźwigu ani nie gwarantuje dostępności przy niepełnych danych.

## Przyjazd i zakończenie wezwania

Po zatrzymaniu windy i otwarciu drzwi na wskazanym piętrze pojawia się „Winda przyjechała”. Gdy dane wskazują brak miejsca dla grupy, aplikacja utrzymuje oczekiwanie zamiast ogłaszać realizację przydziału. W demonstracji wejście grupy potwierdza symulator. Jeśli grupa nie wsiądzie w czasie otwarcia drzwi, przydział miejsc wygasa, a aplikacja umożliwia ponowne wezwanie.

## Anulowanie

Przycisk „Anuluj wezwanie” usuwa własne zgłoszenie i zwalnia przewidywany przydział miejsc. Nie kasuje wezwań innych osób ani fizycznych przycisków. Jeżeli dany postój wynika także z innego zgłoszenia, pozostaje w trasie. Wybrany już przez sterownik odcinek ruchu jest kończony zgodnie ze stanem windy.

# 4 Wspólna kolejka i fizyczne przyciski

## Źródła zgłoszeń

Naciśnięcie fizycznego przycisku na piętrze jest odczytywane przez adapter sterownika i dodaje wezwanie do tej samej kolejki, do której trafiają zgłoszenia z telefonów. Zdarzenie określa piętro, czas i kierunek, jeśli przycisk go rozróżnia. Przycisk w kabinie dodaje piętro docelowe jako obowiązkowy postój. W demonstracji oba rodzaje przycisków odtwarza panel symulatora.

Zgłoszenia mają źródło „Aplikacja”, „Przycisk piętrowy” lub „Przycisk kabinowy”. Identyfikator zdarzenia pozwala odrzucić powtórzony komunikat. Wezwania na to samo piętro i w tym samym kierunku mogą współdzielić postój; każde zachowuje własny status. Samo otwarcie drzwi nie usuwa grupy oczekującej na miejsce.

## Kolejność obsługi

Model demonstracyjny kończy aktualny odcinek ruchu i realizuje zaplanowane postoje. Nowe zgłoszenia są porządkowane według czasu przyjęcia. Przydział grup uwzględnia pojemność, a wezwanie, którego nie można obsłużyć w danym przejeździe, zachowuje swój pierwotny czas oczekiwania. Cele kabinowe pozostają w trasie, ponieważ dotyczą pasażerów już znajdujących się w windzie.

W realnej integracji sterownik windy pozostaje źródłem prawdy o trasie i ruchu. Aplikacja odczytuje fizyczne wezwania i przekazuje własne przez obsługiwany interfejs. Nie usuwa fizycznych postojów ani nie wymusza zmiany trasy, jeśli interfejs sterownika nie udostępnia takiej operacji.

## Liczba osób przy fizycznym wezwaniu

Zwykły przycisk informuje o wezwaniu, ale nie o liczbie czekających pasażerów. Dlatego system nie przypisuje mu automatycznie wartości „1 osoba”. Taki wpis ma nieznaną liczebność. Do wiarygodnej oceny dostępności służą dane o faktycznej zajętości kabiny i zarejestrowanych wejściach oraz wyjściach; w demo są one jawnie podawane w symulatorze.

Jeżeli instalacja nie dostarcza takich danych, aplikacja pokazuje „Dostępność miejsc niepotwierdzona” i szacuje czas dojazdu bez obietnicy zabrania grupy. Czujnik obciążenia sam w sobie podaje masę, a nie dokładną liczbę osób. Ochrona przed przeciążeniem należy do sterownika windy.

## Przykład wspólnej obsługi

Dwie osoby wzywają windę z 4. piętra przez aplikację. W tym czasie mieszkaniec naciska przycisk na 2. piętrze. Wpis z przycisku pojawia się w kolejce, a plan przejazdu i ETA grupy są przeliczane. Jeśli po postoju na 2. piętrze w kabinie pozostaje tylko jedno wolne miejsce, grupa dwóch osób czeka na późniejszy przejazd; jej zgłoszenie nie przepada.

# 5 Czas przyjazdu i informacje o windzie

## Zakres prognozy

Czas przyjazdu oznacza przewidywany czas do zatrzymania i otwarcia drzwi na piętrze użytkownika w przejeździe, do którego jego grupa jest przypisana. Obliczenie uwzględnia bieżącą pozycję, kierunek, fazę drzwi, wszystkie znane postoje, wezwania fizyczne i mobilne oraz dostępność miejsc dla grupy.

ETA = pozostały czas aktualnej fazy + czas jazdy po zaplanowanej trasie + czasy pośrednich postojów + otwarcie drzwi na piętrze odbioru. Jeśli grupa oczekuje na późniejszy przejazd, prognoza zawiera również znane odcinki i postoje poprzedzające ten przejazd. Nieznane przyszłe wezwania i nieznane cele pasażerów nie są traktowane jako potwierdzone zdarzenia.

## Aktualizacja prognozy

Każde nowe wezwanie, przycisk kabinowy, wejście lub wyjście pasażera oraz zmiana stanu drzwi powoduje przeliczenie. Ekran może pokazać „około 30 s”, a po zmianie kolejki „około 45 s”. Opis pod czasem wyjaśnia zmianę, np. „Dodano postój na 2. piętrze” albo „Oczekiwanie na miejsce dla 3 osób”.

W symulatorze przejazd między sąsiednimi piętrami trwa 3 s, otwieranie 2 s, postój z otwartymi drzwiami 5 s i zamykanie 2 s. Dojazd z parteru na 5. piętro, bez dodatkowych postojów i z początkowo zamkniętymi drzwiami, trwa do otwarcia 17 s. Parametry dotyczą demonstracji; realne wartości pochodzą z konfiguracji lub pomiarów instalacji.

## Informacje widoczne dla mieszkańca

| **Informacja** | **Przykład** |
| --- | --- |
| **Położenie** | **Winda między 3. a 4. piętrem.** |
| **Kierunek** | **Jedzie w górę.** |
| **Czas dla zgłoszenia** | **Przyjazd za około 30 s.** |
| **Grupa** | **Wezwanie dla 2 osób.** |
| **Dostępność** | **Przewidywane miejsce dla Twojej grupy.** |
| **Brak wiarygodnych danych** | **Dostępność miejsc niepotwierdzona.** |
| **Powód oczekiwania** | **Najbliższy przejazd jest zajęty.** |

## Nieaktualne dane i awaria

Po utracie połączenia aplikacja oznacza pozycję jako ostatnio znaną i zatrzymuje wiarygodne odliczanie. Nie pokazuje potwierdzenia dla nowego wezwania bez odpowiedzi serwera. Po powrocie sieci pobiera aktualną kolejkę i status własnego zgłoszenia. Awaria wyświetla komunikat „Winda niedostępna”, blokuje nowe wezwania i przerywa prognozę. Sam powrót połączenia nie oznacza przyjazdu windy.

# 6 Wygląd aplikacji i układ ekranów

## Styl wizualny

Interfejs ma jasne tło w odcieniu złamanej bieli, ciemnogranatowy tekst i niebieski kolor głównych działań. Zieleń oznacza dostępność lub przyjazd, bursztynowy oczekiwanie, a czerwony awarię. Każdy kolor jest uzupełniony tekstem lub ikoną. Elementy mają zaokrąglone narożniki, wyraźne odstępy i duże pola dotykowe; ekran jest czytelny przy obsłudze jedną ręką.

## Ekran główny

Górny pasek pokazuje nazwę budynku, stan połączenia i ikonę ustawień. Poniżej znajduje się karta wezwania: pole „Twoje piętro”, licznik „Ile osób jedzie?” z przyciskami minus i plus oraz szeroki niebieski przycisk „Wezwij windę”. Domyślne piętro jest zapamiętane, ale można je zmienić przed każdym zgłoszeniem.

Centralnym elementem jest pionowa wizualizacja bloku. Każdy poziom ma numer piętra, a pośrodku znajduje się szyb z kabiną. Piętro użytkownika jest wyróżnione niebieskim tłem i etykietą „Twoje piętro”. Kabina porusza się płynnie między poziomami. Strzałka przy niej pokazuje kierunek; krótki opis obok podaje pozycję i stan drzwi. Na wąskim ekranie wizualizacja znajduje się pod formularzem, na szerszym obok niego.

## Ekran aktywnego wezwania

Po przyjęciu zgłoszenia karta formularza zmienia się w kartę oczekiwania. Największy tekst przedstawia szacowany czas, pod nim widoczne są piętro i liczba pasażerów. Pasek statusu pokazuje „Wezwanie przyjęte”, „Oczekiwanie na miejsce” albo „Winda jedzie do Ciebie”. Użytkownik ma dostęp do zmiany liczby osób i anulowania zgłoszenia.

Przy braku miejsca karta przyjmuje bursztynowy akcent i wyjaśnia, że grupa czeka na kolejny dostępny przejazd. Po przyjeździe przydzielonej windy karta jest zielona, a komunikat brzmi „Winda przyjechała na Twoje piętro”. Komunikat jest wyświetlany w aplikacji; nie zakłada się dostarczenia powiadomienia po zamknięciu jej na telefonie.

## Ustawienia i widok administracyjny

Ustawienia zawierają domyślne piętro, nazwę instalacji oraz informację o przypisanym budynku. Administrator zarządza kodami QR i aktywowanymi instalacjami. Oddzielny panel demonstracyjny pozwala nacisnąć przycisk piętrowy lub kabinowy, zmienić zajętość kabiny, zasymulować wejście i wyjście pasażerów oraz awarię. Zmiany panelu są widoczne na telefonach mieszkańców.

## Czytelność i dostępność

Tekst i przyciski zachowują czytelność przy powiększeniu. Pola mają etykiety, a stan można odczytać bez rozróżniania kolorów. Dostępna jest obsługa klawiaturą oraz ograniczenie animacji. Czytnik ekranu otrzymuje komunikaty o przyjęciu wezwania, zmianie dostępności i przyjeździe, bez odczytywania każdej klatki ruchu.

# 7 Budowa systemu i przepływ danych

## Warstwy aplikacji

Frontend React i TypeScript prezentuje wizualizację i obsługuje formularze. Cloudflare Worker realizuje API, aktywację i kontrolę dostępu. Durable Object utrzymuje wspólny stan windy, kolejkę i przydziały grup. Aktualizacje trafiają do klientów przez WebSocket. Zapis trwały obejmuje kolejkę, stan przejazdu i znaczniki czasu, dzięki czemu wznowienie backendu nie tworzy nowej, niezależnej windy dla każdego telefonu.

Adapter windy przekazuje zdarzenia przycisków, położenia, drzwi i zajętości oraz przesyła zaakceptowane wezwania do sterownika. Symulator korzysta z tego samego formatu zdarzeń, zastępując sprzęt w demonstracji. Animacja na telefonie jedynie odtwarza stan serwera; nie steruje ruchem i nie ustala kolejności.

## Dane zgłoszenia

| **Pole** | **Znaczenie** |
| --- | --- |
| **callId i requestId** | **Identyfikator zgłoszenia i identyfikator ponowienia żądania.** |
| **buildingId i installationId** | **Budynek oraz aktywowana instalacja dla zgłoszenia z aplikacji.** |
| **source** | **Aplikacja, przycisk piętrowy lub przycisk kabinowy.** |
| **floor i direction** | **Piętro i kierunek, jeśli dana instalacja go obsługuje.** |
| **passengerCount** | **Liczba zadeklarowana w aplikacji; nieznana dla zwykłego przycisku.** |
| **status i assignment** | **Etap oczekiwania oraz przypisany przejazd i miejsca.** |
| **createdAt i eta** | **Czas przyjęcia oraz aktualna prognoza dla grupy.** |

## Przetwarzanie zdarzenia

Serwer sprawdza uprawnienia i poprawność wezwania, zapisuje je i aktualizuje trasę. Następnie wylicza dostępność miejsc oraz ETA i rozsyła nową wersję stanu. Zdarzenie fizycznego przycisku przechodzi analogiczną ścieżkę, z identyfikatorem źródła sprzętowego zamiast instalacji telefonu. Po rozłączeniu klient pobiera pełny stan i ignoruje starsze aktualizacje.

## Granice informacji

Dane o liczebności grup pochodzą z deklaracji mieszkańców. Faktyczna zajętość pochodzi z symulatora lub telemetrii instalacji. Użytkownik widzi, czy dostępność jest przewidywana, potwierdzona danymi czy nieznana. System nie udostępnia mieszkańcom nazw innych urządzeń ani informacji pozwalających przypisać cudze przejazdy do konkretnych osób.

## Dokumentacja technologii

Cloudflare Workers Static Assets: https://developers.cloudflare.com/workers/static-assets/

Cloudflare Durable Objects WebSockets: https://developers.cloudflare.com/durable-objects/best-practices/websockets/

PWA Installation: https://web.dev/learn/pwa/installation/

