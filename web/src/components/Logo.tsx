// SPDX-License-Identifier: Apache-2.0

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#0b1210" />
      <path d="M28 8h8v7l3 4v4H25v-4l3-4z" fill="#4ce0a8" />
      <path d="M24 26h16v22a8 8 0 0 1-16 0z" fill="none" stroke="#d7f5e8" strokeWidth="3" />
      <path d="M27 38h10v9a5 5 0 0 1-10 0z" fill="#4ce0a8" />
    </svg>
  );
}
