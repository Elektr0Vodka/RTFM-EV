import { api } from '../api';
import { loadCardBrand, type CardBrand } from './brand';

/** The app brand for a card, read from the server settings (default brand when unreachable). */
export async function loadShareBrand(): Promise<CardBrand> {
  const settings = await api.getSettings().catch(() => null);
  return loadCardBrand(settings);
}
