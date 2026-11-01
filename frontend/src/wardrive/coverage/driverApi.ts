// The driver's coverage map calls (/api/wardrive, wardrive session cookie).
import { wardriveCall } from '../api';
import { coverageApi, type CoverageApi } from './api';

export const driverCoverageApi: CoverageApi = coverageApi(wardriveCall);
