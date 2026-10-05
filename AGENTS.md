# MOW | HARMONOGRAM INTERNATU — zależność legacy

## Tożsamość
- Repozytorium: `JarekDymek/Harmonogram-MOW`
- Kod: **HARMONOGRAM-INTERNAT-LEGACY**
- Status: **LEGACY ACTIVE DEPENDENCY / MAINTENANCE ONLY**
- Funkcja: działająca PWA + Google Apps Script odczytująca grafiki internatu z Gmaila i udostępniająca dane obecnemu staremu Asystentowi MOW.

## Bardzo ważne
- To repozytorium **nie jest** GH2.
- To repozytorium **nie jest** GH3.
- To repozytorium **nie jest** AUDYTOR-INTERNAT.
- To repozytorium **nie jest** nowym projektem `MOW | MÓJ PLAN`.
- Nie używaj nazwy „Harmonogram MOW” jako ogólnego określenia innych aplikacji.

## Zasada rozwoju
- Nie rozwijaj tu nowych funkcji, jeśli nie jest to konieczna poprawka utrzymaniowa obecnej zależności.
- Nowy kierunek planu pracy rozwijany jest w `JarekDymek/mow-moj-plan`.
- Obecny `JarekDymek/AsMOW` nadal korzysta z tego mechanizmu; dlatego repozytorium **nie może zostać usunięte ani zarchiwizowane**, dopóki zależność nie zostanie faktycznie wyłączona i zweryfikowana.
- Po migracji konsumentów do nowego rozwiązania repo może zostać kandydatem do archiwizacji.

## Ochrona
Nie zapisuj tokenów Gmail/Calendar, prawdziwych załączników z grafikami ani danych prywatnych w Git.
