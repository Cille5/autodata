# autodata

Autoliikkeiden vaihtoautotiedot JSON-muodossa, haettu Nettiautosta ajastetusti.

| Liike | Osoite |
|---|---|
| Automyynti Kylmälä Oy | https://cille5.github.io/autodata/kylmala/autot.json |

## Miten toimii

- `hae-nettiauto.js` lukee liikkeen Nettiauto-ilmoitukset ja kirjoittaa kansion `autot.json`:in
  (lisää uudet, poistaa myydyt, päivittää hinnat; `badge`-kentät säilyvät).
- GitHub Actions (`.github/workflows/paivita.yml`) ajaa sen **maanantaisin klo 06** Suomen aikaa
  ja committaa muutokset. Päivityksen voi ajaa heti: Actions → "Päivitä autot" → Run workflow.
- GitHub Pages tarjoaa tiedostot julkisesti. Sivustot hakevat JSONin `fetch`illä (CORS sallittu).

## Uusi liike

1. Luo kansio `liike/` ja sinne tyhjä `autot.json` (`[]`).
2. Lisää skriptiin liikkeen Nettiauto-osoite parametriksi ja työnkulkuun uusi askel.

## Paikallinen ajo

```bash
cd kylmala && node ../hae-nettiauto.js
```

Vaatii Noden ja `curl`in.
