import { useId } from 'react';
import { Button } from '../components/ui/button';
import { useT } from '../i18n';
import { declineBuddyTourOffer, snoozeBuddyTourOffer, startBuddyTour } from './buddyTour';
import type { BuddyTourId } from './buddyTourSteps';

/** i18n key prefix of a tour's card; the walkthrough keeps its original keys. */
function offerKey(tour: BuddyTourId): string {
  return tour === 'main' ? 'buddy_tour_offer' : `buddy_tour_offer_${tour}`;
}

/**
 * The card that offers a tour once: the guided walkthrough on a fresh install
 * (no buddy is loaded before the user says yes), an add-on tour the first time
 * a radio with its features is connected. It sits in a corner and blocks nothing.
 */
export function BuddyTourOffer({ tour, zIndex }: { tour: BuddyTourId; zIndex: string }) {
  const t = useT();
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-buddy-tour-offer={tour}
      className="fixed bottom-24 right-4 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ zIndex }}
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t(`${offerKey(tour)}_title`)}
      </h2>
      <p className="mt-1 text-sm leading-relaxed">{t(`${offerKey(tour)}_text`)}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => declineBuddyTourOffer(tour)}
        >
          {t('buddy_tour_offer_never')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={() => snoozeBuddyTourOffer(tour)}
        >
          {t('buddy_tour_offer_later')}
        </Button>
        <Button type="button" size="sm" className="h-8" onClick={() => startBuddyTour(tour)}>
          {t('buddy_tour_offer_start')}
        </Button>
      </div>
    </div>
  );
}
