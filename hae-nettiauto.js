/*
 * Päivittää autot.json-tiedoston Kylmälän omien Nettiauto-ilmoitusten mukaiseksi:
 * lisää uudet autot, poistaa myydyt ja päivittää hinnat, ja hakee jokaiselle autolle
 * kuvat, tekniset tiedot, varusteet sekä myyjän lisätiedot.
 *
 * Aja komentoriviltä kansiossa f:\Kodio\autoliike:
 *     node hae-nettiauto.js
 *
 * Kentät badge ja muut käsin lisätyt tiedot säilyvät. Tiedosto kirjoitetaan vain jos
 * ilmoituslista saatiin luettua, joten katkennut yhteys ei tyhjennä autolistaa.
 */
const fs = require('fs');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const LIIKE = 'https://www.nettiauto.com/yritys/749618';
const KEKSIT = path.join(os.tmpdir(), 'nettiauto-keksit.txt');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

/* Nämä näytetään jo auton sivun perustiedoissa tai eivät kuulu sivulle */
const OHITA = ['Mittarilukema', 'Vaihteisto', 'Vuosimalli', 'VIN-numero'];

const puhdista = s => s.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
const tauko = () => execFileSync(process.execPath, ['-e', 'setTimeout(()=>{},1000)']);

function hae(url){
  return execFileSync('curl', ['-sL', '--max-time', '40', '-c', KEKSIT, '-b', KEKSIT,
    '-A', UA, '-H', 'Accept-Language: fi-FI,fi;q=0.9', url], { encoding: 'utf8', maxBuffer: 40 * 1024 * 1024 });
}

/* ---------- Liikkeen ilmoituslista: mitkä autot ovat nyt myynnissä ---------- */

/* Nimi katkaistaan sanan rajalta, jotta autokortit pysyvät siisteinä */
function lyhenna(teksti){
  const t = teksti.replace(/\s+/g, ' ').trim();
  if (t.length <= 70) return t;
  const katkaistu = t.slice(0, 70);
  return katkaistu.slice(0, katkaistu.lastIndexOf(' '));
}

function varasto(){
  const lista = [];
  const nahdyt = new Set();
  for (let sivu = 1; sivu <= 20; sivu++){
    const html = hae(LIIKE + '?page=' + sivu);
    const ennen = nahdyt.size;
    html.split('<div class="list-card-sds clearfix">').slice(1).forEach(kortti => {
      const id = (kortti.match(/yritys\/\d+\/(\d+)/) || [])[1];
      if (!id || nahdyt.has(id)) return;
      const otsikko = puhdista((kortti.match(/info_details__title">([\s\S]*?)<\/h2>/) || [])[1] || '');
      const malli   = puhdista((kortti.match(/info_details__sub-title">([\s\S]*?)<\/div>/) || [])[1] || '');
      const hinta   = puhdista((kortti.match(/info_price__main">([\s\S]*?)<span/) || [])[1] || '').replace(/\D/g, '');
      const kuva    = (kortti.match(/https:\/\/images\.nettiauto\.com\/[^"'\s]+-medium\.jpg/) || [])[0] || '';
      /* vinfo-rivin järjestys: vuosimalli, mittarilukema, polttoaine, vaihteisto */
      const kentat = ((kortti.match(/vinfo[^>]*>([\s\S]*?)<\/ul>/) || [])[1] || '')
        .split(/<li>/).slice(1).map(puhdista);
      if (!otsikko || !hinta) return;
      nahdyt.add(id);
      lista.push({
        id,
        name:  lyhenna(otsikko),
        malli: malli.replace(/^\(\d[.,]\d\)\s*/, ''),
        sub:   malli,
        price: +hinta,
        year:  +(kentat[0] || '').replace(/\D/g, ''),
        km:    +(kentat[1] || '').replace(/\D/g, ''),
        fuel:  kentat[2] || '',
        gear:  kentat[3] || '',
        img:   kuva,
        url:   LIIKE + '/' + id
      });
    });
    console.log('  sivu ' + sivu + ': ' + (nahdyt.size - ennen) + ' ilmoitusta');
    if (nahdyt.size === ennen) break;
    tauko();
  }
  return lista;
}

/* ---------- Yksittäisen ilmoituksen tiedot ---------- */

/* Kuvat: ilmoituksen isot kuvat esiintymisjärjestyksessä, kukin kerran */
function kuvat(html){
  const lista = [];
  const re = /https:\/\/images\.nettiauto\.com\/[^"'\s\\]+-large\.jpg/g;
  let m;
  while ((m = re.exec(html))) if (!lista.includes(m[0])) lista.push(m[0]);
  return lista;
}

/* Ilmoituksen väliotsikot (Perustiedot, Tekniset tiedot, Turvallisuus, ...) sijainteineen,
   jotta jokainen tieto ja varuste osataan sijoittaa samaan osioon kuin Nettiautossa */
function osiot(html){
  const lista = [];
  const re = /vehicle-all-info__mobile-title[^>]*>([\s\S]{0,150}?)<\/button>|vehicle-all-info__title[^>]*>([\s\S]{0,150}?)<\/div>/g;
  let m;
  while ((m = re.exec(html))){
    const nimi = puhdista(m[1] || m[2] || '');
    if (nimi && (!lista.length || lista[lista.length - 1].nimi !== nimi)) lista.push({ nimi, alku: m.index });
  }
  return lista;
}
const osio = (lista, kohta) => {
  let nimi = '';
  for (const o of lista) if (o.alku < kohta) nimi = o.nimi; else break;
  return nimi;
};

/* Tekniset tiedot osioittain: { "Perustiedot": { nimi: arvo }, "Tekniset tiedot": { ... } } */
function tiedot(html, lista){
  const out = {};
  const re = /vehicle-info-box__vehicle-info[^"]*">([\s\S]*?)vehicle-info-box__vehicle-det[^"]*">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))){
    const nimi = m[1].replace(/<[^>]*>/g, '\n').split('\n').map(x => x.trim()).filter(Boolean)[0];
    const arvo = puhdista(m[2]);
    if (!nimi || !arvo || OHITA.includes(nimi)) continue;
    const ryhma = osio(lista, m.index) || 'Tekniset tiedot';
    (out[ryhma] = out[ryhma] || {})[nimi] = arvo;
  }
  return out;
}

/* Varusteet osioittain: { "Turvallisuus": [...], "Sisätilat ja mukavuudet": [...] }.
   Sivulla sama lista toistuu koottuna, joten kootut rivit karsitaan pois. */
function varusteet(html, lista){
  const kaikki = [];
  const re = /vehicle-all-info__details_block">([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(html))){
    const t = puhdista(m[1]);
    if (t && !kaikki.some(x => x.teksti === t)) kaikki.push({ teksti: t, ryhma: osio(lista, m.index) });
  }
  const yksittaiset = [];
  [...kaikki].sort((a, b) => a.teksti.length - b.teksti.length).forEach(x => {
    if (!yksittaiset.some(p => x.teksti.includes(p))) yksittaiset.push(x.teksti);
  });

  const out = {};
  kaikki.forEach(x => {
    /* Lisätiedot toistaa muiden osioiden varusteet, joten se jätetään pois */
    if (!yksittaiset.includes(x.teksti) || !x.ryhma || x.ryhma === 'Lisätiedot') return;
    (out[x.ryhma] = out[x.ryhma] || []).push(x.teksti);
  });
  return out;
}

/* Lisätiedot = myyjän oma teksti. Nettiauto liittää sen keskelle koko varustelistan uudelleen,
   joten rivit jotka ovat sellaisenaan varusteosioissa jätetään pois. */
function lisatiedot(html, varusteObj){
  const m = html.match(/id="fullNote"[^>]*>([\s\S]*?)<\/div>/);
  if (!m) return [];
  const varusteet = new Set(Object.values(varusteObj).flat());
  return m[1].split(/<\/p>|<br\s*\/?>/i).map(puhdista).filter(r => r && !varusteet.has(r));
}

/* Myyntiteksti ilmoituksen yläosasta, esim. "Siistikuntoinen pikkupaku ilman adblueta!" */
function myyntiteksti(html){
  return puhdista((html.match(/unique-selling-point">([\s\S]*?)<\/div>/) || [])[1] || '');
}

/* ---------- Päivitys ---------- */

console.log('Luetaan liikkeen ilmoituslista...');
const myynnissa = varasto();
if (!myynnissa.length){
  console.error('Ilmoituslistaa ei saatu luettua – autot.json jätettiin ennalleen.');
  process.exit(1);
}

const vanhat = new Map(JSON.parse(fs.readFileSync('autot.json', 'utf8')).map(c => [String(c.id), c]));
const myydyt = [...vanhat.values()].filter(c => !myynnissa.some(u => u.id === String(c.id)));

console.log('\nMyynnissä ' + myynnissa.length + ' autoa. Haetaan ilmoitusten tiedot...\n');

const autot = [];
let uusia = 0, virheita = 0;

for (const perus of myynnissa){
  const vanha = vanhat.get(perus.id);
  if (!vanha) uusia++;
  /* Vanhan auton omat lisäykset (badge ym.) säilyvät, ilmoituksen tiedot päivittyvät päälle */
  const auto = Object.assign({}, vanha, perus);
  try {
    const html = hae(auto.url);
    const lista = osiot(html);
    const kuvalista = kuvat(html);
    const tiedotObj = tiedot(html, lista);
    const varusteObj = varusteet(html, lista);
    if (!kuvalista.length && !Object.keys(tiedotObj).length) throw new Error('sivulta ei löytynyt tietoja');

    const lisat = lisatiedot(html, varusteObj);
    const teksti = myyntiteksti(html);

    if (teksti) auto.sub = teksti;
    if (kuvalista.length) auto.images = kuvalista;
    if (Object.keys(tiedotObj).length) auto.tiedot = tiedotObj;
    if (Object.keys(varusteObj).length) auto.varusteet = varusteObj;
    if (lisat.length) auto.lisatiedot = lisat;

    const tietoja = Object.values(tiedotObj).reduce((n, r) => n + Object.keys(r).length, 0);
    const varusteita = Object.values(varusteObj).reduce((n, r) => n + r.length, 0);
    console.log((vanha ? '  ' : '+ ') + auto.name + ': ' + kuvalista.length + ' kuvaa, '
      + tietoja + ' tietoa, ' + varusteita + ' varustetta, ' + lisat.length + ' lisätietoriviä');
  } catch (e){
    virheita++;
    console.log('! ' + auto.name + ': ' + e.message);
  }
  autot.push(auto);
  tauko();
}

autot.sort((a, b) => a.name.localeCompare(b.name, 'fi'));
fs.writeFileSync('autot.json', JSON.stringify(autot, null, 2) + '\n', 'utf8');

console.log('\nValmis: ' + autot.length + ' autoa listalla, ' + uusia + ' uutta, '
  + myydyt.length + ' poistettu, ' + virheita + ' ilmoitusta epäonnistui.');
if (myydyt.length) console.log('Poistetut (ei enää Nettiautossa): ' + myydyt.map(c => c.name).join(', '));
