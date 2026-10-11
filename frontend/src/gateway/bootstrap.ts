// Imported first by main.tsx, before any module that reads browser storage at
// import time, so radio 1 finds its per-radio values on the very first load in
// multi-radio mode.

import { migrateLegacyRadioKeys } from './context';

migrateLegacyRadioKeys();
