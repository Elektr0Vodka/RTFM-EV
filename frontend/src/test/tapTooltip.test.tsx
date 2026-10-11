import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TapTooltipLayer, tapTooltipTarget } from '../components/TapTooltipLayer';

/** jsdom has no PointerEvent, and pointerType is the field that matters here. */
function pointer(element: Element, type: 'pointerdown' | 'pointerup', pointerType: string) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  fireEvent(element, event);
}

/** A finger: press and release. iOS Safari may send no click after it. */
function tap(element: Element, pointerType = 'touch') {
  pointer(element, 'pointerdown', pointerType);
  pointer(element, 'pointerup', pointerType);
}

function mouseClick(element: Element) {
  pointer(element, 'pointerdown', 'mouse');
  pointer(element, 'pointerup', 'mouse');
  fireEvent.click(element);
}

function renderPage() {
  const onButton = vi.fn();
  render(
    <>
      <TapTooltipLayer />
      <span title="Heard 3 hops away">3</span>
      <span title="Battery at 4.1 V">4.1</span>
      <p>plain text</p>
      <button type="button" title="Send the message" onClick={onButton}>
        Send
      </button>
    </>
  );
  return { onButton };
}

describe('TapTooltipLayer on a touch screen', () => {
  it('shows the title of a tapped element', () => {
    renderPage();

    tap(screen.getByText('3'));

    expect(screen.getByRole('tooltip')).toHaveTextContent('Heard 3 hops away');
  });

  it('works for a pen as well', () => {
    renderPage();

    tap(screen.getByText('3'), 'pen');

    expect(screen.getByRole('tooltip')).toHaveTextContent('Heard 3 hops away');
  });

  it('ties the bubble to the element for assistive technology', () => {
    renderPage();
    const anchor = screen.getByText('3');

    tap(anchor);
    expect(anchor).toHaveAttribute('aria-describedby', screen.getByRole('tooltip').id);

    tap(anchor);
    expect(anchor).not.toHaveAttribute('aria-describedby');
  });

  it('moves to another element when that one is tapped', () => {
    renderPage();

    tap(screen.getByText('3'));
    tap(screen.getByText('4.1'));

    expect(screen.getAllByRole('tooltip')).toHaveLength(1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Battery at 4.1 V');
  });

  it('does nothing for a mouse, which has hover', () => {
    renderPage();

    mouseClick(screen.getByText('3'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('leaves a titled button to do its own job', () => {
    const { onButton } = renderPage();
    const button = screen.getByRole('button', { name: 'Send' });

    tap(button);
    fireEvent.click(button);

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
    expect(onButton).toHaveBeenCalledTimes(1);
  });

  it('shows nothing for text without a title', () => {
    renderPage();

    tap(screen.getByText('plain text'));

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('TapTooltipLayer dismissing', () => {
  it('closes when the same element is tapped again', () => {
    renderPage();
    const anchor = screen.getByText('3');

    tap(anchor);
    expect(screen.getByRole('tooltip')).toBeInTheDocument();

    tap(anchor);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes when something else is pressed', () => {
    renderPage();

    tap(screen.getByText('3'));
    pointer(screen.getByText('plain text'), 'pointerdown', 'touch');

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderPage();

    tap(screen.getByText('3'));
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('closes on scroll, resize and a view change', () => {
    renderPage();
    const anchor = screen.getByText('3');

    tap(anchor);
    fireEvent.scroll(screen.getByText('plain text'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    tap(anchor);
    fireEvent(window, new Event('resize'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    tap(anchor);
    fireEvent(window, new Event('hashchange'));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });
});

describe('tapTooltipTarget', () => {
  const hosts: HTMLElement[] = [];

  function element(html: string): HTMLElement {
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.appendChild(host);
    hosts.push(host);
    return host.firstElementChild as HTMLElement;
  }

  afterEach(() => {
    for (const host of hosts.splice(0)) host.remove();
  });

  it('takes the nearest title above the press', () => {
    const outer = element('<div title="outer"><span>text</span></div>');
    expect(tapTooltipTarget(outer.querySelector('span'))).toBe(outer);
  });

  it('ignores an empty title and a missing one', () => {
    expect(tapTooltipTarget(element('<span title="   ">x</span>'))).toBeNull();
    expect(tapTooltipTarget(element('<span>x</span>'))).toBeNull();
  });

  it('ignores a titled control, whose press is its own', () => {
    for (const html of [
      '<button title="Send">x</button>',
      '<a href="#x" title="Open">x</a>',
      '<span role="button" title="Show route">x</span>',
      '<span role="combobox" title="Pick one">x</span>',
      '<span tabindex="0" title="Mention someone">x</span>',
      '<input title="Name" />',
      '<label title="Option"><input type="checkbox" /></label>',
    ]) {
      expect(tapTooltipTarget(element(html)), html).toBeNull();
    }
  });

  it('ignores a title wrapped around a control, when the control is pressed', () => {
    const wrapper = element('<div title="row"><button>press</button></div>');
    expect(tapTooltipTarget(wrapper.querySelector('button'))).toBeNull();
    // The rest of the row still explains itself.
    expect(tapTooltipTarget(wrapper)).toBe(wrapper);
  });

  it('lets a surface opt out', () => {
    const opted = element('<div data-no-tap-tooltip><span title="chart point">x</span></div>');
    expect(tapTooltipTarget(opted.querySelector('span'))).toBeNull();
  });
});
