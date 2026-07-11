import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from './App';

describe('PLT-0 scaffold smoke test', () => {
  it('renders the PharmaQMS shell', () => {
    render(<App />);
    expect(screen.getByText('PharmaQMS')).toBeInTheDocument();
  });
});
