import type { Map as MlMap } from 'maplibre-gl';

// Canvas packet-replay overlay, projected against MapLibre `map.project`.
// Ported from the ParticleOverlay in the old MapView. Paths are [lng, lat]
// pairs to match MapLibre conventions.

export interface MapParticle {
  id: number;
  path: [number, number][]; // [lng, lat] waypoints
  color: string;
  startedAt: number;
}

const PARTICLE_LIFETIME_MS = 3000;
const PARTICLE_TAIL_LENGTH = 0.25;
const PARTICLE_RADIUS = 8;
const PARTICLE_TAIL_WIDTH = 5;

export type Projector = (lngLat: [number, number]) => { x: number; y: number };

/** Project a [lng,lat] path to container points using the map projector. Pure. */
export function projectParticlePath(
  path: [number, number][],
  project: Projector
): { x: number; y: number }[] {
  return path.map((p) => project(p));
}

export function createParticleOverlay(map: MlMap) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = map as any;
  const container: HTMLElement = m.getContainer();
  const canvas = document.createElement('canvas');
  canvas.style.position = 'absolute';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.pointerEvents = 'none';
  canvas.style.zIndex = '450';
  container.appendChild(canvas);

  let particles: MapParticle[] = [];
  let raf = 0;
  let running = false;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  };
  resize();

  const project: Projector = (lngLat) => {
    const pt = m.project(lngLat);
    return { x: pt.x, y: pt.y };
  };

  const draw = () => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const now = Date.now();
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    for (const particle of particles) {
      const elapsed = now - particle.startedAt;
      if (elapsed < 0 || elapsed > PARTICLE_LIFETIME_MS) continue;
      const progress = elapsed / PARTICLE_LIFETIME_MS;
      if (particle.path.length < 2) continue;

      const pixelPath = projectParticlePath(particle.path, project);
      const segLengths: number[] = [];
      let totalLen = 0;
      for (let i = 1; i < pixelPath.length; i++) {
        const dx = pixelPath[i].x - pixelPath[i - 1].x;
        const dy = pixelPath[i].y - pixelPath[i - 1].y;
        const len = Math.sqrt(dx * dx + dy * dy);
        segLengths.push(len);
        totalLen += len;
      }
      if (totalLen === 0) continue;

      const headDist = progress * totalLen;
      const tailDist = Math.max(0, headDist - PARTICLE_TAIL_LENGTH * totalLen);
      const pointAtDist = (d: number): { x: number; y: number } => {
        let accum = 0;
        for (let i = 0; i < segLengths.length; i++) {
          if (accum + segLengths[i] >= d) {
            const tt = segLengths[i] > 0 ? (d - accum) / segLengths[i] : 0;
            return {
              x: pixelPath[i].x + (pixelPath[i + 1].x - pixelPath[i].x) * tt,
              y: pixelPath[i].y + (pixelPath[i + 1].y - pixelPath[i].y) * tt,
            };
          }
          accum += segLengths[i];
        }
        const last = pixelPath[pixelPath.length - 1];
        return { x: last.x, y: last.y };
      };

      const head = pointAtDist(headDist);
      const tail = pointAtDist(tailDist);
      const grad = ctx.createLinearGradient(tail.x, tail.y, head.x, head.y);
      grad.addColorStop(0, particle.color + '00');
      grad.addColorStop(1, particle.color + 'cc');
      ctx.beginPath();
      ctx.moveTo(tail.x, tail.y);
      const steps = 8;
      for (let s = 1; s <= steps; s++) {
        const d = tailDist + ((headDist - tailDist) * s) / steps;
        const pt = pointAtDist(d);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = grad;
      ctx.lineWidth = PARTICLE_TAIL_WIDTH;
      ctx.lineCap = 'round';
      ctx.stroke();

      const fade = progress > 0.8 ? 1 - (progress - 0.8) / 0.2 : 1;
      const alpha = Math.round(fade * 230)
        .toString(16)
        .padStart(2, '0');
      ctx.beginPath();
      ctx.arc(head.x, head.y, PARTICLE_RADIUS + 4, 0, Math.PI * 2);
      ctx.fillStyle =
        particle.color +
        Math.round(fade * 40)
          .toString(16)
          .padStart(2, '0');
      ctx.fill();
      ctx.beginPath();
      ctx.arc(head.x, head.y, PARTICLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = particle.color + alpha;
      ctx.shadowColor = particle.color;
      ctx.shadowBlur = 12 * fade;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(head.x, head.y, PARTICLE_RADIUS * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff' + alpha;
      ctx.fill();
    }
    ctx.restore();
    if (running) raf = requestAnimationFrame(draw);
  };

  m.on('resize', resize);
  m.on('move', resize);

  return {
    setParticles(list: MapParticle[]) {
      particles = list;
    },
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(draw);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    destroy() {
      running = false;
      cancelAnimationFrame(raf);
      m.off('resize', resize);
      m.off('move', resize);
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    },
  };
}
