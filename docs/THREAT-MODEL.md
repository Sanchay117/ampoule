# Threat model

## Parties and trust

| Party | Holds | Trusted for |
|---|---|---|
| Medical council | council secret | licensing real doctors and suspending bad ones |
| Drug controller | controller secret | licensing real pharmacies and setting caps |
| Health-ID registrar | registrar secret | enrolling one key per real person |
| Doctor | doctor secret | prescribing honestly (the per-doctor counters exist because this can fail) |
| Pharmacy | pharmacy secret (its hash is registered; no circuit needs it yet) | handing over what the opening says, once |
| Patient | patient secret, on their phone | nothing: the contract assumes the patient may cheat |

The three authorities hold separate keys sealed at deploy time. None of them can issue a prescription or fill one.

## Attacks the contract stops

| Attack | Result | Code |
|---|---|---|
| Fill the same prescription twice, at the same or another pharmacy | the fill nullifier is already spent | `ALREADY_FILLED` |
| Collect a controlled drug from several doctors and pharmacies in one window | the cap nullifier for this person, class and window is already spent | `CAP_REACHED` |
| Edit a prescription (drug, quantity, fills, expiry) | its hash is not in the issued tree | `NO_SUCH_PRESCRIPTION` |
| Write a prescription without a licence | no registered key hash for that id | `UNKNOWN_DOCTOR`, `NOT_THIS_DOCTOR` |
| Use someone else's prescription | it names a different patient key | `NOT_YOUR_PRESCRIPTION` |
| Fill after the doctor is suspended | the fill reads the licence status | `DOCTOR_SUSPENDED` |
| Replay a fill transaction, or answer a counter request twice | the challenge already has a fill record | `CHALLENGE_USED` |
| Use a proof after its deadline | block time is not before `validBefore` | `REQUEST_EXPIRED` |
| Spend next month's cap now | the window must contain the block time and the deadline | `WRONG_WINDOW` |
| Fill at an unlicensed or suspended pharmacy | pharmacy registry check | `UNKNOWN_PHARMACY`, `PHARMACY_SUSPENDED` |
| Pharmacist hands over something else | the patient's opening must match the commitment in the fill record | checked off chain by `Pharmacy.verify` |

Because these are assertions inside the circuit, a cheating phone cannot produce a valid proof. The SDK's witnesses are untrusted inputs: every property is re-checked in the circuit, and the model-based property test drives random histories through the contract and compares every outcome with a plain reference model.

## Privacy attacks

| Observer | Wants to learn | Outcome |
|---|---|---|
| Anyone reading the chain | who takes what | No patient identifier, drug, quantity or expiry is published. See [PRIVACY-BOUNDARY.md](PRIVACY-BOUNDARY.md). |
| Anyone reading the chain | whether two fills are the same person | Nullifiers are hashes keyed by the patient secret, so they are unlinkable. Pharmacy, prescriber, class and time are public, so in a small network a guess is possible. |
| The prescribing doctor | whether and where the patient filled | The fill does not reveal the leaf, and the nullifier needs the patient secret. |
| A pharmacy | the patient's other prescriptions or history | Nothing beyond the fill it handles. A cap refusal reveals only that this person is over the cap for this class. |
| The registrar | prescriptions | It enrolls keys; prescriptions never pass through it. |

## Assumptions and open issues

- **Sybil resistance comes from the registrar.** Two keys for one person mean two caps. The registrar must deduplicate people off chain (national health IDs already do).
- **Fee payer linkage.** The contract never uses the fee-paying wallet for authorization, but a wallet that pays for every fill of one patient links those fills outside the contract. Deployments should have the pharmacy (or a relayer) pay: the patient's phone hands the proven, unbalanced transaction to the counter, and the counter balances and submits it. The demo CLI pays everything from one operator wallet.
- **Lost or stolen phones.** The secret is the patient's identity on the network. There is no key revocation for patients yet; a registrar can enroll a new key, and open prescriptions must be reissued to it. A thief with the phone and the unlocked app could fill the patient's prescriptions, as with a stolen paper prescription.
- **Doctor key theft.** A stolen doctor secret can issue prescriptions until the council rotates the key (`setDoctor` with a new key hash) or suspends the licence. Per-doctor controlled volumes are public, so spikes are visible.
- **Filling ahead of time.** The fill does not need the pharmacy's signature, so a patient can make up a counter request naming a pharmacy and fill from home. Every rule still holds (one fill, the cap, the licence checks), and the record names that one pharmacy, so it can only be redeemed there. A pharmacy must therefore keep a log of the challenges it has dispensed against, so that one record is handed over once. Pharmacy key hashes are registered so that a later version can require a counter-signature.
- **The prover sees the witnesses.** A proof server receives the private inputs of every proof it makes, the patient's secret included. A patient's fill must therefore be proved on their own device or by a proof server they run (the CLI uses a local one on port 6300; a wallet such as Lace can prove inside the wallet). A pharmacy or a hosted service must never prove a patient's fill.
- **Coarse timing.** Every fill publishes a deadline at most 30 minutes after it was proven, and its block time. That is when it happened, not who.
- **Expiry edge case.** A fill in a prescription's last 30 minutes publishes its exact expiry; see [PRIVACY-BOUNDARY.md](PRIVACY-BOUNDARY.md).
- **Tree capacity.** Both Merkle trees have depth 16: 65,536 patients and 65,536 prescriptions per deployment. A production network would use deeper trees or shard by period.
