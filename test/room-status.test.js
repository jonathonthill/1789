import test from 'node:test';
import assert from 'node:assert/strict';
import { roomResumeStatus } from '../server/room-status.js';

const rooms = new Map([['ABCD', {
  status: 'playing',
  players: [
    { token: 'host-token' },
    { token: 'guest-token' },
  ],
}]]);

test('a remembered seat is resumable while its room still exists', () => {
  assert.deepEqual(roomResumeStatus(rooms, ' abcd ', 'guest-token'), {
    open: true,
    status: 'playing',
  });
});

test('room availability does not expose missing rooms or unknown seats', () => {
  assert.deepEqual(roomResumeStatus(rooms, 'WXYZ', 'guest-token'), { open: false });
  assert.deepEqual(roomResumeStatus(rooms, 'ABCD', 'wrong-token'), { open: false });
  assert.deepEqual(roomResumeStatus(rooms, 'ABCD', null), { open: false });
});
