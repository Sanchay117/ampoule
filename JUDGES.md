# Ampoule in five minutes

Prefer to watch first? The [3-minute demo video](https://youtu.be/CUaj5al-Ff4) shows the guided demo, a live run on Midnight Preview and the public audit.

## 1. See it work (2 minutes, no install)

Open the **[guided demo](https://sanchay117.github.io/ampoule/#/demo)**. Either click through the chapters, or press **Play the whole story** in the left column and then click any chapter to see how it ended.

Things worth looking at:

- **Chapter 3, at the counter.** Ravi's phone lists exactly what the fill will publish and what it will not, before he proves. After the fill, the dark panel on the right decodes the transaction's transcript line by line (16 operations) and shows the search for his secret key, his patient key, the prescription hash, the drug code, both salts and the expiry date. None is found. The pharmacy's licence number is found, because it is public on purpose.
- **Chapters 4 to 6, the attacks.** A screenshot of a used prescription (`ALREADY_FILLED`), a second prescription from a second doctor in another city (`CAP_REACHED`), an edited quantity (`NO_SUCH_PRESCRIPTION`), someone else's prescription (`NOT_YOUR_PRESCRIPTION`). Each fails on the phone, before anything is proven, and the chain panel confirms nothing was published.
- **Chapter 7, a month later.** The same person fills again in the next window. The two fill records and the two cap nullifiers are shown side by side: nothing on chain ties them together.
- **Chapter 9, the regulator.** Everything anyone can read. Per-doctor volumes, licence status, fill records with no patient column.

## 2. Check it on chain (1 minute)

Open the **[on-chain page](https://sanchay117.github.io/ampoule/#/ledger)** and press **Run the checks**. Your browser downloads every transaction of the deployed contract from the public Preview indexer and verifies that:

- the call history is exactly the transactions in the committed evidence file, so the refused attempts left nothing;
- the public state equals the state the run ended with;
- every prescription in the audit disclosure was really issued;
- none of the run's private values (patient keys, drug codes, salts, prescription hashes) occurs in the raw bytes of any transaction, while public licence numbers do.

The same checks run from a terminal with `npm run cli -- verify`, which needs no wallet.

## Optional: run it with your own wallet (10 minutes, needs Lace on Preview)

Open the **[live page](https://sanchay117.github.io/ampoule/#/live)** and connect Lace. It deploys your own copy of the contract and runs the core of the story with real proofs: the authorities set up, a doctor prescribes, the patient fills, the pharmacist checks, a second fill is refused (`ALREADY_FILLED`), and a second doctor's prescription is refused at a second pharmacy (`CAP_REACHED`). Lace balances and submits each of the 10 transactions. Under each one, the page shows a search of that transaction's raw bytes for the step's private values. At the end, **Audit your contract** runs the same checks as the on-chain page.

## 3. Read the code (2 minutes)

- [`contract/src/ampoule.compact`](contract/src/ampoule.compact): about 300 lines. The `fill` circuit at the bottom is the core.
- [`contract/test/privacy.test.ts`](contract/test/privacy.test.ts): what each circuit reveals, asserted on decoded transcripts.
- [`contract/test/model.property.test.ts`](contract/test/model.property.test.ts): random histories of issues, fills, time jumps and suspensions, checked against a plain reference model.
- [`sdk/src/roles.ts`](sdk/src/roles.ts): one client per participant, each holding only its own secret.
- [`sdk/src/transcript.ts`](sdk/src/transcript.ts): the decoder behind the chain panel.
- [`docs/PRIVACY-BOUNDARY.md`](docs/PRIVACY-BOUNDARY.md) and [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md).

## Why Midnight

The cap has to hold across pharmacies that do not trust each other, so it needs shared, verifiable state. Its inputs are medical records, so they cannot be in that state. Compact lets the contract take them as private witnesses, prove the rules over them, and publish only what the source marks with `disclose()`. Nullifiers keyed by a secret only the patient holds give one-time use and per-person caps without an identity on chain.
