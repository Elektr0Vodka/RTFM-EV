import { describe, expect, it } from 'vitest';
import { resetLumaOnContext } from '../../map/layers/packetDeckOverlay';

describe('resetLumaOnContext', () => {
  it('removes luma.gl own-property wrappers and state, keeping prototype methods', () => {
    class FakeGl {
      viewport() {
        return 'proto';
      }
    }
    const gl = new FakeGl() as unknown as Record<string, unknown>;
    gl.viewport = () => 'wrapped';
    gl.useProgram = () => 'wrapped';
    gl.luma = { device: {} };
    gl.lumaState = { cache: {} };
    gl.canvasLike = 42; // non-function own data is left alone

    resetLumaOnContext(gl as unknown as WebGL2RenderingContext);

    expect((gl.viewport as () => string)()).toBe('proto');
    expect('useProgram' in gl).toBe(false);
    expect('luma' in gl).toBe(false);
    expect('lumaState' in gl).toBe(false);
    expect(gl.canvasLike).toBe(42);
  });
});
