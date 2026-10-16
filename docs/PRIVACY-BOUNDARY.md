# Privacy boundary

What each circuit puts in its public transcript, read off [`ampoule.compact`](../contract/src/ampoule.compact). In Compact, a value derived from a witness or a circuit argument can reach the ledger only through `disclose()`, so the `disclose()` calls below, plus the ledger reads they key, are the complete list. Line numbers refer to `ampoule.compact`.

[`contract/test/privacy.test.ts`](../contract/test/privacy.test.ts) and [`sdk/test/transcript.test.ts`](../sdk/test/transcript.test.ts) decode real transcripts and assert this table.

## Per circuit

### `setDoctor(id, keyHash, active)`, `setPharmacy(...)`, `setPolicy(...)`

Authority calls. The caller proves knowledge of the authority secret by hashing it and comparing with the sealed key hash (lines 162, 172, 181); the secret itself is never disclosed.

| Disclosed | Line |
|---|---|
| licence id, key hash, active flag | 163, 168 / 173, 177 |
| class, window, max fills | 182 to 186 |

All of this is public by design: a regulator publishes licences and caps.

### `enrollPatient(patientKey)`

| Disclosed | Line | Note |
|---|---|---|
| a hash of the patient key, as a new leaf of the patient tree | 192 | The tree stores the hash of each leaf, so the key itself is not in the transcript. The registrar learns the key (it enrolls it); nobody else does. |

The patient key is itself `H("ampoule:v1:patient", secret)`, so even the registrar never sees the secret.

### `issue()`

The whole prescription is a private witness.

| Disclosed | Line | Why |
|---|---|---|
| the doctor's licence id | 205 | per-doctor counters, licence check |
| the drug class | 212 | per-doctor count of controlled prescriptions; the class must have a cap policy |
| `H(leaf)` as a new prescription tree leaf, where `leaf = H(prescription)` | 217 | so the patient can later prove membership |

Not disclosed: the patient key, the drug, the quantity, the number of fills, the expiry date, the salt, the leaf itself. The doctor's secret is checked against the registered key hash (line 208) and never disclosed.

### `fill(pharmacyId, challenge, epoch, validBefore)`

The secret, the prescription, both Merkle paths, the fill number, the cap slot and the dispense salt are private witnesses.

| Disclosed | Line | Why |
|---|---|---|
| pharmacy licence id | 233 | the fill happens at a licensed, active pharmacy; per-pharmacy counters |
| counter challenge | 236 | one fill per counter request; the fill record is stored under it |
| a past root of the patient tree | 244 | membership, without saying which leaf |
| a past root of the prescription tree | 252 | membership, without saying which leaf |
| the prescriber's licence id | 255 | suspended doctors' prescriptions stop filling; per-doctor fill volumes |
| `validBefore` | 259 | a deadline at most 30 minutes ahead; the block must be earlier |
| fill nullifier `H(secret, leaf, k)` | 266 | spent once per fill number |
| drug class | 271 | which cap applies; per-class volumes |
| window number `epoch` | 274 | which cap window is spent; it is the current time rounded to the window length (0 for general medicine) |
| cap nullifier `H(secret, class, epoch, slot)` | 280 | spent once per slot per window |
| dispense commitment `H(drug, quantity, salt)` | 289 | the pharmacist checks what they hand over |

Not disclosed: the secret, the patient key, the leaf or its hash, the drug, the quantity, the expiry date, the salt, which fill number or cap slot was used.

## Implied facts

Asserts on private values reveal one bit each: that they held. A published fill therefore also says:

- the prescription's expiry is no earlier than `validBefore` (line 261);
- for a capped class, the deadline is inside the current window (line 277).

## Edge case: a deadline that equals the expiry

The phone sets `validBefore` to the earliest of now plus 30 minutes, the end of the cap window, and the prescription's expiry (`Patient.plan` in [`sdk/src/roles.ts`](../sdk/src/roles.ts)). When a prescription is filled in the last 30 minutes before it expires, `validBefore` is the exact expiry date. That reveals one private field of one prescription, at a moment when it no longer matters much. Rounding `validBefore` down to a coarse grid (for example 15 minutes) would remove it at the cost of a shorter proof lifetime.

## Who learns what

| | Ledger (everyone) | Council, controller | Registrar | Doctor | Pharmacy | Patient |
|---|---|---|---|---|---|---|
| Patient identity | no | no | yes, once | yes | sees the person, gets no record | yes |
| Patient key | no (only a hash) | no | yes | yes (in the prescription) | no | yes |
| Drug and quantity | no (commitment) | no | no | what they prescribe | what they dispense | yes |
| Expiry date | no (lower bound only) | no | no | yes | no | yes |
| That a fill happened, where, by whose prescription, which class | yes | yes | yes | yes | their own | yes |
| Which fills are the same person's | no | no | no | no | no | yes |

The doctor cannot recognise when their prescription is filled: the fill nullifier is keyed by the patient secret, and the fill does not reveal the leaf.
