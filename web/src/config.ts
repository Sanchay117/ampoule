// SPDX-License-Identifier: Apache-2.0
//
// Build-time settings. The Pages workflow sets VITE_REPO_URL from the repository it runs in.

export const REPO_URL: string | undefined = import.meta.env.VITE_REPO_URL || undefined;
