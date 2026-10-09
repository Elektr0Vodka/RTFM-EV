import { cn } from '@/lib/utils';

export interface AppBrandProps {
  brandName?: string;
  brandHidden?: boolean;
  brandIcon?: string;
}

interface Props extends AppBrandProps {
  /** Logo only (the collapsed sidebar rail). */
  iconOnly?: boolean;
  iconClassName?: string;
}

/** The app logo and name, as shown in the top bar or at the head of the Atlas sidebar. */
export function AppBrand({
  brandName,
  brandHidden = false,
  brandIcon,
  iconOnly = false,
  iconClassName = 'h-4 w-4',
}: Props) {
  return (
    <>
      {brandIcon ? (
        <img
          src={brandIcon}
          alt=""
          aria-hidden="true"
          className={cn('shrink-0 object-contain', iconClassName)}
        />
      ) : (
        <svg
          className={cn('app-brand-logo shrink-0 text-white', iconClassName)}
          viewBox="0 0 512 512"
          fill="currentColor"
          aria-hidden="true"
        >
          <path d="m455.68 85.902c-31.289 0-56.32 25.031-56.32 56.32 0 11.379 3.4141 21.617 8.5352 30.152l-106.38 135.39c12.516 6.2578 23.895 15.359 32.996 25.602l107.52-136.54c4.5508 1.1367 9.1016 1.707 13.652 1.707 31.289 0 56.32-25.031 56.32-56.32 0-30.719-25.031-56.32-56.32-56.32z" />
          <path d="m256 343.04c-5.6875 0-10.809 0.57031-15.93 2.2773l-106.38-135.96c-9.1016 10.809-20.48 19.344-32.996 25.602l106.38 135.96c-5.1211 8.5352-7.3945 18.203-7.3945 28.445 0 31.289 25.031 56.32 56.32 56.32s56.32-25.031 56.32-56.32c0-31.293-25.031-56.324-56.32-56.324z" />
          <path d="m356.69 114.91c3.9805-13.652 10.238-26.738 19.344-37.547-38.113-13.652-78.508-21.047-120.04-21.047-59.164 0-115.48 14.789-166.12 42.668-9.1016-6.8281-21.051-10.809-33.562-10.809-31.289-0.57031-56.32 25.027-56.32 55.75 0 31.289 25.031 56.32 56.32 56.32 31.289 0 56.32-25.031 56.32-56.32 0-3.4141-0.57031-6.8281-1.1367-9.6719 44.371-23.895 93.297-36.41 144.5-36.41 34.703 0 68.836 5.6914 100.69 17.066z" />
        </svg>
      )}
      {!brandHidden && !iconOnly && (brandName?.trim() ? brandName : 'RTFM-EV')}
    </>
  );
}
