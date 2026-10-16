# Who Ampoule is for, and how it gets used

## Regulators set the rules, pharmacies run them

Controlled-drug rules are written by regulators and enforced at the pharmacy counter. Ampoule is built around that split.

- **Drug controllers and medical councils.** In India, the state drug controllers under the Drugs and Cosmetics Act and the NDPS Act, and the medical councils. In the US, the state boards that run prescription monitoring. They license doctors and pharmacies, set caps and suspend licences. In Ampoule, each of these actions is one transaction proved with a key only that authority holds. In return they get live public counts per doctor, per pharmacy and per drug class, and no patient register to guard.
- **Pharmacies.** An Indian pharmacy already keeps a separate Schedule H1 register for listed antibiotics, habit-forming drugs and anti-TB drugs. Each entry records the prescriber's name and address, the patient's name, the drug and the quantity, and the register is kept for three years for inspectors [1]. The register cannot stop anything across pharmacies, because the next pharmacy never sees it. Ampoule gives the pharmacist one check at the counter that covers every pharmacy in the network.
- **Doctors and their software.** For e-prescription and hospital software vendors, issuing is one SDK call. The patient gets the prescription as a QR code, like the paper slip.
- **Patients.** The prescription lives on their phone and the counter scans a QR code. Nothing about the patient is published.

## Why now

- **India keeps tightening controls.** Tramadol was declared a psychotropic substance under the NDPS Act in April 2018 to curb abuse and trafficking [2]. Pregabalin was reported moved to Schedule H1 in May 2026 [3]. Each new listing adds entries to a paper register at every pharmacy.
- **India already has the registrar Ampoule needs.** By July 2025, 79.71 crore ABHA health accounts had been created [4]. An ABHA-linked app can enroll one patient key per person, which is what makes the cap a cap per person.
- **US prescription monitoring is built on a named database.** Since 2023, Medicare Part D has required controlled-substance prescriptions to be sent electronically [5]. Enforcement runs through state prescription drug monitoring programmes. These are named databases, and in 31 states police can query them without a warrant [6].
- **Doctor shopping is concentrated.** In a national US study, 0.7% of opioid buyers obtained 1.9% of all opioid prescriptions, averaging 32 prescriptions from 10 prescribers each [7]. That is the pattern a per-person cap across pharmacies stops.

## Adoption path

1. **Usable at a real counter (Wave 3).** This means:
   - a patient wallet that installs as a web app and keeps prescriptions offline;
   - a counter page that scans the patient's QR code with the camera;
   - doctor and authority roles signed through Lace;
   - fills proved by the patient's own wallet. Never by the pharmacy, because a prover sees the patient's secret.
2. **A pilot in one area.** One hospital, the pharmacies around it, and one or two controlled classes, for example tramadol and alprazolam in one city. The state drug controller holds the controller key and an ABHA-linked app acts as registrar. The pilot measures time at the counter and refused attempts against the paper register.
3. **Integrations.** These are:
   - an issuing plug-in for e-prescription software;
   - a counter plug-in for pharmacy billing software, where the H1 register is already kept;
   - patient enrollment from the ABHA app.
4. **More drug classes, more states.** Each controller sets its own caps on the same contract. A suspension by one council stops that doctor's open prescriptions at every pharmacy.

## Business model

- **A fee per controlled fill**, paid by the pharmacy or the programme operator. Fees on Midnight are paid in DUST, which the operator generates by holding NIGHT. Patients and pharmacies never handle tokens.
- **A regulator dashboard.** It builds on the public tables in the demo and adds alerts, such as a doctor whose volume doubles or a pharmacy filling far more than its neighbours.
- **SDK licences** for e-prescription and pharmacy software vendors that add sealed prescriptions to products they already sell.

## What has to be true

- **The regulator accepts the fill record.** It has to stand in for the register entry even though it carries no patient name. A pilot would run in a regulatory sandbox. Where the law still requires the name, the pharmacy keeps it off chain, as it does today.
- **The registrar enrolls each person once.** The cap is per person only if the registrar refuses duplicates ([threat model](THREAT-MODEL.md)).
- **Proving fits the visit.** The `fill` proof takes tens of seconds on a laptop proof server, and a phone has to prove it for itself. The phone can prove before the patient reaches the counter, naming the pharmacy in a request it makes itself ([threat model](THREAT-MODEL.md)). The counter then only reads the record and checks the opening.

## Sources

1. Schedule H1 register under the Drugs and Cosmetics Rules, 1945 (GSR 588(E), 30 August 2013): [Insights on India](https://www.insightsonindia.com/2020/03/28/what-is-a-schedule-h1-drug/), [NTEP](https://ntep.in/node/938).
2. Tramadol notified as a psychotropic substance, S.O. 1761(E), 26 April 2018: [Mondaq](https://mondaq.com/india/food-and-drugs-law/701838/government-declares-tramadol-a-psychotropic-substance-to-curb-its-abuse-and-trafficking), [BioSpectrum](https://biospectrumindia.com/news/22/10849/govt-brings-tramadol-under-narcotics-law-regulation.html).
3. Pregabalin moved to Schedule H1: [Insights on India, May 2026](https://www.insightsonindia.com/2026/05/23/health-ministry-brings-pregabalin-under-schedule-h1/).
4. 79.71 crore ABHA accounts as of 28 July 2025, Lok Sabha reply: [The Week](https://www.theweek.in/wire-updates/national/2025/08/01/del53-lsq-health-record.html).
5. Electronic prescribing of controlled substances under Medicare Part D, SUPPORT Act section 2003, first measurement year 2023: [CMS EPCS guide](https://cms.gov/files/document/epcs-program-getting-started-quick-reference-guide.pdf).
6. Warrantless police access to prescription monitoring databases: [ACLU](https://aclu.org/issues/privacy-technology/medical-and-genetic-privacy/prescription-drug-monitoring-programs).
7. McDonald and Carlson, "Estimating the Prevalence of Opioid Diversion by 'Doctor Shoppers' in the United States", PLOS ONE, 2013: [PMC3714248](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3714248/).
