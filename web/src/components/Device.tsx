// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from 'react';

export interface DeviceProps {
  name: string;
  sub: string;
  /** What kind of screen this is: "clinic", "phone", "counter". */
  what: string;
  color: string;
  wide?: boolean;
  testId?: string;
  children: ReactNode;
}

const initials = (name: string) =>
  name
    .replace(/^Dr /, '')
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('');

/** One participant's screen. Everything inside it is that participant's private view. */
export function Device({ name, sub, what, color, wide, testId, children }: DeviceProps) {
  return (
    <section className={`device${wide ? ' wide' : ''}`} data-testid={testId} aria-label={`${name}, ${what}`}>
      <header className="device-top">
        <div className="avatar" style={{ background: color }}>
          {initials(name)}
        </div>
        <div className="who">
          <b>{name}</b>
          <span>{sub}</span>
        </div>
        <div className="what">{what}</div>
      </header>
      <div className="device-body">{children}</div>
    </section>
  );
}

export const COLORS = {
  rao: '#2f6f9f',
  mehta: '#7a4fa3',
  lotus: '#0d7a5a',
  neem: '#5b7d1a',
  ravi: '#b0582a',
  meera: '#a3416b',
  council: '#33433d',
};
