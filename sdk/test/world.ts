// SPDX-License-Identifier: Apache-2.0
//
// A small network on the simulator backend, built only through the public SDK.
import {
  Controller,
  Council,
  DAY,
  Doctor,
  drugByCode,
  id32,
  Patient,
  Pharmacy,
  randomBytes32,
  Registrar,
  SimulatorBackend,
  type Drug,
} from '../src/index.js';

/** 2026-10-16T00:00:00Z. */
export const T0 = 1_792_108_800n;
export const OPIOIDS = 1n;

export const drug = (code: string): Drug => {
  const d = drugByCode(code);
  if (!d) throw new Error(`no such drug ${code}`);
  return d;
};

export async function world(now = T0) {
  const councilSk = randomBytes32();
  const controllerSk = randomBytes32();
  const registrarSk = randomBytes32();
  const backend = SimulatorBackend.deploy({ councilSk, controllerSk, registrarSk, now });
  const council = new Council(backend, councilSk);
  const controller = new Controller(backend, controllerSk);
  const registrar = new Registrar(backend, registrarSk);

  await controller.setPolicy(OPIOIDS, 30n * DAY, 1n);
  const rao = new Doctor(backend, id32('MC-DL-58213'));
  const mehta = new Doctor(backend, id32('MC-MH-11902'));
  await council.license(rao);
  await council.license(mehta);
  const lotus = new Pharmacy(backend, id32('DL-RX-20B-4471'));
  const neem = new Pharmacy(backend, id32('MH-RX-21B-0932'));
  await controller.license(lotus);
  await controller.license(neem);
  const ravi = new Patient(backend);
  await registrar.enroll(ravi.publicKey);

  return { backend, council, controller, registrar, rao, mehta, lotus, neem, ravi };
}
