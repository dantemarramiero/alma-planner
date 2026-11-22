# Alma Space → BOSS: creare l'anagrafica del personale (ALM2-63)

Quando un candidato accetta l'offerta, Alma Space manda a BOSS i dati della persona perché BOSS crei
la sua anagrafica del personale. Questa pagina è per il team di BOSS: dice cosa Alma manda e cosa si
aspetta in risposta. Il lato Alma è già pronto; serve l'endpoint su BOSS.

## Cosa va a BOSS e cosa no

- **Va a BOSS:** solo la persona assunta (dati anagrafici, contratto, RAL, BU, a chi riporta).
- **Resta in Alma:** la posizione della richiesta di personale, i candidati, i colloqui e le offerte.
  BOSS non riceve posizioni né incarichi nuovi. Se la richiesta era nata da un incarico vacante di
  BOSS, Alma manda il suo id in `incaricoBossId`, così BOSS può metterci la persona.

## Chiamata

```
POST {BOSS_PERSONALE_CREATE_URL}
Authorization: Bearer {token}
Content-Type: application/json
Idempotency-Key: alma-preboarding-<id>
```

In Alma (variabili di Railway):

| Variabile | Cosa |
|---|---|
| `BOSS_PERSONALE_CREATE_URL` | URL dell'endpoint di BOSS che crea la persona |
| `BOSS_PERSONALE_CREATE_TOKEN` | token; se manca si usa `BOSS_PERSONALE_TOKEN` (quello della lettura del personale) |

Finché `BOSS_PERSONALE_CREATE_URL` non c'è, Alma non chiama nessuno: nel pre-boarding il team HR vede
«BOSS non collegato» e usa «Copia i dati».

## Corpo (JSON)

I nomi dei campi sono quelli dell'elenco del personale che BOSS manda già ad Alma.

| Campo | Tipo | Esempio | Note |
|---|---|---|---|
| `riferimentoAlma` | testo | `alma-preboarding-12` | Sempre uguale per la stessa persona: serve a non creare doppioni |
| `nome` | testo | `Giulio` | |
| `cognome` | testo | `Pace` | |
| `email` | testo o null | `giulio.pace@example.com` | Email **personale** della candidatura, non quella aziendale |
| `telefono` | testo o null | `+39 333 1234567` | |
| `sesso` | `F`, `M` o null | `M` | Facoltativo |
| `dataAssunzione` | data `AAAA-MM-GG` | `2027-02-01` | Primo giorno di lavoro |
| `contratto` | testo | `TI` | `TI`, `TD`, `APPR`, `STAFF_LEASING`, `TIROCINIO` |
| `livelloCCNL` | testo o null | `Metalmeccanico B2` | Come scritto nell'offerta |
| `ralAnnua` | numero (euro) | `47000` | RAL dell'offerta accettata |
| `periodoProvaMesi` | numero o null | `6` | |
| `businessUnit` | testo o null | `Impianti` | Nome dell'area (BU o funzione) |
| `qualifica` | testo o null | `Project Manager` | Ruolo del mansionario di Alma |
| `grade` | numero o null | `4` | Salary grade G1–G8 |
| `sede` | testo o null | `Pescara` | |
| `responsabileEmail` | testo o null | `mario.rossi@almacis.it` | A chi riporta |
| `incaricoBossId` | testo o null | `i3` | Solo se la richiesta era nata da un incarico vacante di BOSS |

## Risposta attesa

- **201** (o 200) con `{ "id": "<id della persona su BOSS>", "bossUrl": "https://…" }`.
  `bossUrl` è facoltativo: se c'è, nel pre-boarding compare «Apri su BOSS».
- **409** se esiste già una persona con lo stesso `riferimentoAlma`: va bene, con lo stesso corpo `{ "id": … }`.
  Alma la considera inviata.
- **4xx/5xx** con `{ "error": "testo" }`: Alma segna «invio non riuscito» e mostra il testo al team HR.

## Cosa fa Alma

1. Il candidato accetta → nasce il pre-boarding → Alma chiama BOSS subito.
2. Risposta ok → il compito «Anagrafica del personale a BOSS» si spunta da solo e Alma salva l'id di BOSS.
3. Errore → il team HR riceve un avviso; Alma riprova da sola ogni 6 ore, fino a 10 volte. Dal
   pre-boarding il team HR può premere «Riprova» o usare «Copia i dati».
4. Alla sincronizzazione notturna del personale Alma ritrova la persona (prima per l'id di BOSS, poi
   per email e per nome e cognome). Il primo giorno il pre-boarding si chiude e parte l'onboarding.
