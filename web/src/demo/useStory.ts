// SPDX-License-Identifier: Apache-2.0
import { useSyncExternalStore } from 'react';
import { Story } from './story';

// One story per tab, kept across route changes so leaving the demo and coming back resumes it.
let story: Story | undefined;

export function getStory(): Story {
  story ??= new Story();
  return story;
}

/** The story, re-rendering the caller whenever anything in it changes. */
export function useStory(): Story {
  const s = getStory();
  useSyncExternalStore(s.subscribe, s.snapshot);
  return s;
}
