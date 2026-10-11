import { useId } from 'react';
import { Button } from '../components/ui/button';
import { useT } from '../i18n';
import { declineBuddyTourOffer, snoozeBuddyTourOffer, startBuddyTour } from './buddyTour';

/**
 * The first-run card on a fresh install: offers the guided walkthrough once.
 * It sits in a corner and blocks nothing; no buddy is loaded before the user
 * says yes.
 */
export function BuddyTourOffer({ zIndex }: { zIndex: string }) {
  const t = useT();
  const titleId = useId();
  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      data-buddy-tour-offer=""
      className="fixed bottom-24 right-4 w-80 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-lg"
      style={{ zIndex }}
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {t('buddy_tour_offer_title')}
      </h2>
      <p className="mt-1 text-sm leading-relaxed">{t('buddy_tour_offer_text')}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={declineBuddyTourOffer}
        >
          {t('buddy_tour_offer_never')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          onClick={snoozeBuddyTourOffer}
        >
          {t('buddy_tour_offer_later')}
        </Button>
        <Button type="button" size="sm" className="h-8" onClick={startBuddyTour}>
          {t('buddy_tour_offer_start')}
        </Button>
      </div>
    </div>
  );
}
