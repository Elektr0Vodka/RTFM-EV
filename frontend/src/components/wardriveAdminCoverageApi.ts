// The owner's coverage map calls (/api/wardrive-admin, behind the main login):
// everything, or exactly what one driver (or a group's members together)
// would see on their page.
import { api } from '../api';
import { coverageApi, type CoverageApi } from '../wardrive/coverage/api';

export interface ViewAs {
  asUser?: number;
  asGroup?: number;
}

export function adminCoverageApi(view: ViewAs = {}): CoverageApi {
  const extra: Record<string, string> = {};
  if (view.asUser !== undefined) extra.as_user = String(view.asUser);
  else if (view.asGroup !== undefined) extra.as_group = String(view.asGroup);
  return coverageApi(api.wardriveAdmin, extra);
}
