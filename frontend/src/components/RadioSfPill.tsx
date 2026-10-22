import { cn } from '../lib/utils';
import type { RadioStamp } from '../types';
import { contactPillStamps, formatRadioStamp, isNonNormal, pillLabels } from '../utils/radioSf';
import { useContactSightings, useNormalStamp } from '../utils/tempRadio';

const PILL_CLASS =
  'ml-1.5 inline-block align-middle text-[0.625rem] font-medium tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary';

/** One pill per settings set, `SF8`; the full settings are in the title. */
export function RadioSfPills({ stamps, className }: { stamps: RadioStamp[]; className?: string }) {
  if (stamps.length === 0) return null;
  const labels = pillLabels(stamps);
  return (
    <>
      {stamps.map((stamp, i) => (
        <span
          key={`${labels[i]}-${stamp.bw}-${stamp.cr}`}
          className={cn(PILL_CLASS, className)}
          title={formatRadioStamp(stamp)}
        >
          {labels[i]}
        </span>
      ))}
    </>
  );
}

/** Pill for a message or packet heard on settings other than the normal ones. */
export function MessageSfPill({ stamp }: { stamp: RadioStamp | null | undefined }) {
  const normal = useNormalStamp();
  if (!stamp || !isNonNormal(stamp, normal)) return null;
  return <RadioSfPills stamps={[stamp]} />;
}

/** Every settings set a contact was heard on, when one of them is not normal. */
export function ContactSfPills({
  publicKey,
  className,
}: {
  publicKey: string;
  className?: string;
}) {
  const sightings = useContactSightings(publicKey);
  const normal = useNormalStamp();
  return <RadioSfPills stamps={contactPillStamps(sightings, normal)} className={className} />;
}
