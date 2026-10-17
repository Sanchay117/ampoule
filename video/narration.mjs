// SPDX-License-Identifier: Apache-2.0
//
// Narration, one entry per scene, in order. `text` is what the captions show; `say` (optional) is
// what the voice reads when spelling helps pronunciation. Keep sentences short: captions split on them.
// `chapter` is the label burned into the top right of app scenes; card scenes (slides) have none.
export const SCENES = [
  {
    id: 'hook',
    card: 2,
    text: 'A prescription for a controlled drug is two things at once: a medical record that should stay private, and a claim on a supply that gets abused. Copied, filled twice, or collected again from a second doctor at a second pharmacy.',
  },
  {
    id: 'today',
    card: 3,
    text: 'Today you get one or the other. Paper slips, where doctor shopping is invisible to every pharmacy. Or a named register of everyone on painkillers, which police in thirty-one US states can search without a warrant.',
    say: 'Today you get one or the other. Paper slips, where doctor shopping is invisible to every pharmacy. Or a named register of everyone on painkillers, which police in thirty-one U.S. states can search without a warrant.',
  },
  {
    id: 'answer',
    chapter: 'Ampoule',
    text: 'Ampoule enforces the rules on Midnight and never builds the register. One prescription, one fill, and a monthly cap per person across every doctor and pharmacy, while the chain never learns who the patient is.',
  },
  {
    id: 'setup',
    chapter: 'Guided demo',
    text: "The guided demo runs the compiled contract in your browser. Three authorities license doctors and pharmacies, set a cap per drug class, and enroll each patient. Doctor Rao prescribes tramadol. The chain gets one hash, and Ravi's phone gets a QR code.",
    say: "The guided demo runs the compiled contract in your browser. Three authorities license doctors and pharmacies, set a cap per drug class, and enroll each patient. Doctor Rao prescribes tramadol. The chain gets one hash, and Ravi's phone gets a Q.R. code.",
  },
  {
    id: 'counter',
    chapter: 'At the counter',
    text: "At the pharmacy, Ravi's phone proves in zero knowledge that the prescription is real, is his, is unexpired and unfilled, and that he is under this month's opioid cap. The chain panel decodes the published transaction and searches it for every private value. None is there.",
  },
  {
    id: 'attacks',
    chapter: 'Refused',
    text: "A screenshot of the same prescription is refused at another pharmacy: already filled. A second doctor's prescription is refused at the cap. Both refusals happen on Ravi's phone, so nothing reaches the chain.",
  },
  {
    id: 'regulator',
    chapter: 'The regulator',
    text: "The regulator sees volumes per doctor, pharmacy and drug class, and every licence's status. The fill records have no patient column, because the contract has no patient field.",
  },
  {
    id: 'live',
    chapter: 'Live on Midnight Preview',
    text: 'Now for real. The live page connects a Midnight wallet through the DApp Connector API and deploys its own contract on the Preview testnet. Here the command line wallet stands in for Lace, through the same interface.',
    say: 'Now for real. The live page connects a Midnight wallet through the dapp connector A.P.I., and deploys its own contract on the Preview testnet. Here the command line wallet stands in for Lace, through the same interface.',
  },
  {
    id: 'liverun',
    chapter: 'Real proofs, real transactions',
    text: "Each step is proved, balanced and submitted by the wallet, then read back from the indexer. The page searches every transaction's raw bytes for that step's private values, and finds none. The second fill and the doctor shopping attempt are refused before anything is sent.",
  },
  {
    id: 'liveaudit',
    chapter: 'Audit your contract',
    text: 'Then it audits the contract from public data alone: the history, the state, and the search for private values. Every check passes.',
  },
  {
    id: 'ledger',
    chapter: 'On-chain audit',
    text: "The reference deployment's evidence is committed. On the on-chain page, anyone can download every transaction from the public indexer and check it, with no wallet.",
  },
  {
    id: 'evidence',
    card: 10,
    text: 'Underneath: six Compact circuits, seventy-seven tests including privacy tests on decoded transcripts and random histories checked against a model, and one TypeScript SDK behind the demo, the command line and the live page.',
    say: 'Underneath: six Compact circuits, seventy-seven tests, including privacy tests on decoded transcripts and random histories checked against a model, and one TypeScript S.D.K. behind the demo, the command line and the live page.',
  },
  {
    id: 'outro',
    card: 13,
    text: 'Ampoule. Policing controlled drugs, without the register. Built on Midnight.',
  },
];
