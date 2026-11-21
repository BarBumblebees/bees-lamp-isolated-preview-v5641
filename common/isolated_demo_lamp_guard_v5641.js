// Staging-only permission gate. Never rely on this client check for server authorization.
export const VERIFIED_DEMO_STORE = '96095952-db86-4ff1-be81-13ff4633e072';
export function canOperateDemoLamp(profile) {
  return Boolean(profile && profile.allowed === true &&
    profile.default_store_id === VERIFIED_DEMO_STORE);
}
export function assertDemoLampWrite(profile, storeId, state, acknowledged) {
  if (!canOperateDemoLamp(profile) || storeId !== VERIFIED_DEMO_STORE) throw new Error('Unverified demo store');
  if (!['OPEN','AWAY','CLOSE'].includes(state)) throw new Error('Invalid lamp state');
  if (acknowledged !== true) throw new Error('Explicit confirmation required');
  return {p_store_id: VERIFIED_DEMO_STORE,p_status:state};
}
