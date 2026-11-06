// Re-export only. The implementation lives at owner/owner-client.mjs because that
// is the path the site build publishes; keeping a second copy here caused the two
// to drift (the withdrawal method existed in one and not the other).
export { createOwnerClient } from '../owner/owner-client.mjs';
