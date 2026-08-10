// Read-only resume lookup shared by the HTTP availability check and tests.
// A room code alone is deliberately insufficient: only a browser holding a
// seat token may learn whether that particular saved seat can still rejoin.
export function roomResumeStatus(rooms, code, token) {
  const normalizedCode = String(code ?? '').toUpperCase().trim();
  const normalizedToken = String(token ?? '');
  const room = rooms.get(normalizedCode);
  const seatExists = room?.players?.some(player => player.token === normalizedToken);
  return seatExists
    ? { open: true, status: room.status }
    : { open: false };
}
