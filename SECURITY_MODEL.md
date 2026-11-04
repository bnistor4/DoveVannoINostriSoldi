# Modello delle minacce

Questo documento descrive come il progetto valuta i rischi di sicurezza: confini
di fiducia, superfici raggiungibili, asset da proteggere, attaccanti
considerati e controlli già presenti. Le scansioni di sicurezza lo usano per
dare priorità ai finding. Per segnalare una vulnerabilità segui
[SECURITY.md](SECURITY.md), che resta il riferimento per il perimetro.

## Perimetro della scansione

Codice: `src/app`, `src/lib`, `src/components`, `src/proxy.ts`, `scripts`,
`.github`, `supabase`. Restano esclusi gli snapshot di dati generati
(`src/data`, `research`, `tests/fixtures`).

## Sistema e confini di fiducia

App Next.js su Vercel (`vercel.json`: header di sicurezza, `npm ci`, preview
approvate a mano secondo [DEPLOYMENT_APPROVAL.md](docs/DEPLOYMENT_APPROVAL.md))
che pubblica dati aperti sulla spesa pubblica italiana da snapshot versionati e
dal corpus integrato. Host: `dovevannoinostrisoldi.com` e i sottodomini
`politici.` e `comuni.` (`src/proxy.ts`). L'unico stato privato è in Supabase
Postgres, negli schemi `assistant_private` e `boards_private`, raggiungibili
solo con la service role dal server Next (`supabase/migrations/*`, RLS attiva,
grant revocati ad `anon` e `authenticated`).

Confini di fiducia:

1. Internet → edge/WAF Vercel → `src/proxy.ts` (routing per host, blocco dei
   crawler di addestramento, limite per IP locale di riserva) → route handler.
2. Server Next → terze parti con segreti del server: Supabase (service role),
   Resend (email), GitHub App (creazione issue), Regolo (LLM gratuito
   dell'assistente), provider LLM con chiavi BYOK degli utenti (URL fissi in
   `src/lib/assistant/provider-client.ts`).
3. Server Next → fonti pubbliche lette a runtime (per esempio IPA in
   `src/lib/ipa-runtime-fetch.ts`, foto dei politici in
   `src/app/politici/foto/[id]/route.ts`).
4. GitHub Actions → repository: la chiave della GitHub App del data bot
   (`DATA_BOT_APP_PRIVATE_KEY`) apre le PR di refresh; `source-refresh.yml`
   chiama il deployment con `SOURCE_REFRESH_SECRET`.
5. Contributori esterni → PR → CI (`ci.yml`, evento `pull_request`,
   `contents: read`).

## Componenti

| Componente | Codice |
|---|---|
| **Public site & data API** | pagine `src/app/**`, route GET in sola lettura `src/app/api/**` (spese, territori, enti, dati/[dataset], search, …), adapter `src/lib/*`, `src/lib/integrated-*`, `src/components/**`, `src/proxy.ts` |
| **MCP server** | `src/app/api/mcp/route.ts`, `src/lib/mcp/**`, `src/app/for-agents/**` |
| **Assistant** | `src/app/api/assistant/**`, `src/lib/assistant/**` (quota gratuita, BYOK, allegati ed estrazione PDF) |
| **Boards** | `src/app/api/boards/**`, `src/lib/boards/**`, `src/app/condividi/**`, schema `boards_private` |
| **Reports & internal endpoints** | `src/app/api/segnalazioni/route.ts`, `src/lib/report/**`, `src/app/api/internal/refresh-sources/route.ts`, `src/lib/http/public-post-guard.ts`, `src/app/api/share/**` |
| **Data pipeline & CI** | `scripts/**` (ETL, ci, browser, bench), `.github/workflows/**` |
| **Infrastructure** | `vercel.json`, `next.config.ts`, `supabase/migrations/**` |

I nomi dei componenti restano in inglese perché sono gli stessi usati come tag
sui finding delle scansioni.

## Punti di ingresso e chi li raggiunge

- Chiunque: tutte le pagine, circa 138 route API GET, `/api/mcp` (POST,
  OPTIONS, HEAD; allowlist di Host e Origin con `MCP_ALLOWED_HOSTS` e
  `MCP_ALLOWED_ORIGINS`), `/api/search`, `/api/comuni/search`, `/api/location`,
  le immagini di `/api/share/*`, `/politici/foto/[id]`, `/politici/simboli/[id]`.
- Chiunque, con POST protetto dalla verifica di stessa origine
  (`rejectPublicPost`): `/api/segnalazioni` (crea issue GitHub pubbliche; 3 ogni
  10 minuti per indirizzo, 30 per istanza), `/api/assistant` (quota gratuita con
  soggetto HMAC su Supabase), `/api/assistant/chat` (BYOK: provider, modello e
  chiave forniti dall'utente, allegati).
- Utenti Boards (OTP via email o magic link Supabase → cookie firmato HMAC con
  `BOARDS_AUTH_SECRET`): `/api/boards/library*`, `/api/boards/share`,
  `/api/boards/feedback`, `/api/boards/auth/*`. Chiunque abbia un token di
  condivisione: `/api/boards/share/[token]`, `/condividi/[token]`.
- Chi possiede il segreto: `/api/internal/refresh-sources` (Bearer
  `SOURCE_REFRESH_SECRET`, avvia la revalidation).
- Contributori: le PR eseguono la CI. Maintainer e bot: i workflow di refresh
  pianificati che aprono PR di dati.

## Asset e sensibilità

Tutti gli asset seguenti sono importanti per il progetto.

1. **Account Boards**: email, board private (`boards_private.boards.document`),
   sessioni, token di condivisione. Sono dati personali (GDPR).
2. **Chiavi BYOK degli utenti**: arrivano a ogni richiesta su
   `/api/assistant/chat`; non vanno mai registrate nei log, salvate, restituite
   o inviate altrove che all'URL fisso del provider.
3. **Segreti del server**: chiavi service role di Supabase
   (`BOARDS_SUPABASE_SECRET_KEY`, `ASSISTANT_SUPABASE_SECRET_KEY`),
   `BOARDS_AUTH_SECRET`, `ASSISTANT_QUOTA_SECRET`, chiavi delle GitHub App
   (segnalazioni, data bot), `RESEND_API_KEY`, `REGOLO_API_KEY`,
   `SOURCE_REFRESH_SECRET`, `OPENAI_APPS_CHALLENGE_TOKEN`.
4. **Integrità dei dati pubblicati**: provenance, hash e riconciliazioni
   ([DATA_IMPORT_STANDARD.md](docs/DATA_IMPORT_STANDARD.md), import
   fail-closed). Cifre alterate o inventate causano danni reputazionali e legali.
5. **Disponibilità e costi di runtime**: CPU Fluid e memoria delle funzioni
   Vercel, consumo della quota gratuita Regolo, quote delle API GitHub e di
   Resend ([RUNTIME_COSTS.md](docs/RUNTIME_COSTS.md),
   [CAPACITY_AND_INCIDENTS.md](docs/CAPACITY_AND_INCIDENTS.md)).

I dati aperti pubblicati non sono riservati.

## Attaccanti considerati

Tutti i profili seguenti sono nel perimetro.

- Utenti anonimi da internet contro sito, API, MCP, assistente e modulo di
  segnalazione.
- Bot e scraper, anche distribuiti, che fanno salire i costi di CPU, LLM o
  email. I crawler AI di addestramento sono bloccati per policy.
- Contributori esterni malevoli: PR, GitHub Actions, PR di dati che non
  rispettano lo standard di import.
- Fonti a monte o dipendenze npm/PyPI compromesse.
- Utenti Boards autenticati che attaccano board o account di altri utenti.

## Controlli esistenti

- `src/proxy.ts`: finestre scorrevoli per IP e globali (riserva locale; il
  limite reale è il WAF), blocco dei crawler di addestramento, routing per host.
- `src/lib/http/public-post-guard.ts`: Origin della stessa origine obbligatoria
  (fail-closed) e corpo della richiesta limitato.
- MCP: allowlist di host e origin, scadenza delle richieste
  (`src/lib/mcp/request-deadline.ts`), schema delle query.
- Assistente: URL fissi dei provider, rimozione della chiave dai messaggi,
  schemi zod, limiti di dimensione e allegati, quota Supabase con lease (si
  salvano solo identificatori HMAC giornalieri).
- Boards: cookie firmato HMAC con confronto a tempo costante, OTP salvato come
  HMAC, schema Supabase accessibile solo alla service role.
- Endpoint di refresh: segreto Bearer confrontato con `timingSafeEqual`,
  allowlist delle fonti.
- CI: `permissions: contents: read`, CodeQL, dependency review, action pin
  (`npm run ci:action-pins`), approvazione manuale delle preview Vercel.

## Fuori perimetro e rischi accettati

Nessuno. DoS volumetrico e abuso dei costi, script locali e deployment di
preview sono tutti nel perimetro.

## Domande aperte

- I deployment di preview hanno i segreti di produzione (service role
  Supabase, GitHub App)?
- Le regole del WAF Vercel (blocco dei bot AI, limiti di frequenza) sono
  gestite solo dalla dashboard Vercel e non dal codice?
- Quali permessi hanno la GitHub App delle segnalazioni e il data bot (solo
  issue, oppure scrittura su contents)?
