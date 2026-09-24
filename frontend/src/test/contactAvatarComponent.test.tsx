import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ContactAvatar } from '../components/ContactAvatar';
import { CONTACT_TYPE_REPEATER, CONTACT_TYPE_ROOM } from '../types';

// Emoji glyphs depend on the OS emoji font; 🛜 (Unicode 15) rendered as a
// missing-glyph box on older systems (issue #63). Repeater and room avatars
// must be font-independent SVG icons.
describe('ContactAvatar', () => {
  it('renders an SVG icon, not an emoji, for repeaters', () => {
    const { container } = render(
      <ContactAvatar name="Some Repeater" publicKey="abc123" contactType={CONTACT_TYPE_REPEATER} />
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders an SVG icon, not an emoji, for room servers', () => {
    const { container } = render(
      <ContactAvatar name="Ops Board" publicKey="abc123" contactType={CONTACT_TYPE_ROOM} />
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).toBe('');
  });

  it('renders initials text for other contacts', () => {
    const { container } = render(<ContactAvatar name="Jane Smith" publicKey="abc123" />);
    expect(container.querySelector('svg')).toBeNull();
    expect(container.textContent).toBe('JS');
  });
});
