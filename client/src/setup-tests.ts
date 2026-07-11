import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// RTL's own auto-cleanup only registers when it detects a GLOBAL afterEach; our vitest config
// uses `globals: false`, so it never fires without this explicit registration.
afterEach(() => {
  cleanup();
});
