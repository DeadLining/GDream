// Auto-split from lib/api.ts — domain: mock-ssh
// Do not edit manually; regenerate via the split script if api.ts changes.

import { apiRequest, json } from './core';
import type { MockSshHost, MockSshStart, MockSshStatus } from '../types';

export const getMockSshHosts = (signal?: AbortSignal) => apiRequest<MockSshHost[]>('/api/mock-ssh/hosts', {signal});
export const getMockSshStatus = (signal?: AbortSignal) => apiRequest<MockSshStatus>('/api/mock-ssh/status', {signal});
export const startMockSsh = (data: MockSshStart) => apiRequest<MockSshStatus>('/api/mock-ssh/start', json('POST', data));
export const stopMockSsh = () => apiRequest<MockSshStatus>('/api/mock-ssh/stop', json('POST', {}));
