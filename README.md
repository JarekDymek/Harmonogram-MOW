# Harmonogram MOW v12 — pełna wersja z usprawnieniami

Ta paczka zawiera kompletną aplikację PWA i backend Google Apps Script.

## Najważniejsze zmiany v12

- **Kogo zmieniam / kto mnie zmienia** pozostaje w kartach dnia.
- **Zmiany względem poprzedniej wersji grafiku**: backend porównuje najlepszy aktualny dokument tygodnia z poprzednim dokumentem i zwraca listę zmian dla wybranego wychowawcy.
- **Filtr dni**: wszystkie dni, tylko dni pracy, tylko dni ze zmianami, tylko ostrzeżenia.
- **Karta „Dzisiaj / najbliższy dyżur”** na górze aplikacji.
- **Ostrzeżenia**: praca w weekend, długi dzień pracy, noc + poranny wpis w tym samym dniu.
- **Lista wychowawców**: aplikacja podpowiada nazwiska wykryte w dokumentach.
- **Druk / PDF**: przycisk używa systemowego wydruku przeglądarki — na telefonie i PC można zapisać do PDF.
- **Tryb uproszczony dla udostępniania**: można ukryć historię godzin na danym urządzeniu.
- **Bezpieczeństwo**: `VIEW_TOKEN` tylko do podglądu, `ADMIN_TOKEN` tylko dla administratora.
- **Google Calendar**: synchronizacja nadal jest zablokowana wyłącznie dla `CONFIG.calendarEducator`, domyślnie `Dymek`.

## Wgranie backendu Apps Script

W projekcie Apps Script podmień całe pliki:

- `apps-script/Code.gs`
- `apps-script/ParserTests.gs`
- `apps-script/appsscript.json`

Potem uruchom kolejno:

1. `runParserTests`
2. `forceRescan`
3. `install`

Jeżeli pierwszy raz ustawiasz tokeny albo chcesz wygenerować nowe:

1. uruchom `setupSecurityTokens`
2. skopiuj z dziennika `VIEW_TOKEN` i `ADMIN_TOKEN`

Następnie zrób nowe wdrożenie:

`Wdróż → Zarządzaj wdrożeniami → Edytuj → Nowa wersja → Wdróż`

Ustawienia wdrożenia:

- **Wykonaj jako:** Ja
- **Kto ma dostęp:** Każdy

Dostęp „Każdy” jest potrzebny technicznie dla PWA, ale dane są chronione tokenem.

## Wgranie aplikacji na GitHub Pages

Do repozytorium wgraj:

- `index.html`
- `assets/`
- `manifest.webmanifest`
- `service-worker.js`
- `data/`
- `backend-test.html`
- `README.md`

Po zmianie wersji na telefonie usuń starą PWA albo wyczyść jej dane, żeby nie działał stary service worker.

## Udostępnianie innym osobom

Dla innego wychowawcy podajesz tylko:

- link do aplikacji GitHub Pages,
- adres backendu `/exec`,
- `VIEW_TOKEN`.

Nie podawaj `ADMIN_TOKEN`. Bez `ADMIN_TOKEN` użytkownik nie uruchomi skanowania Gmaila ani zapisu do Kalendarza.

## Zalecany model bezpieczeństwa

Najbezpieczniej: każdy wychowawca ma własny backend Apps Script na swoim koncie.

Wariant wspólny: Ty utrzymujesz backend, ale inni dostają tylko `VIEW_TOKEN`. Mogą oglądać plany, ale nie mają dostępu administracyjnego.
