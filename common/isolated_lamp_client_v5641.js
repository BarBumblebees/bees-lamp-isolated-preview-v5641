// Isolated Supabase lamp test client. NEVER import into production pages.
export const ISOLATED_PROJECT_ID = 'sjwitcwhjtznextxswbm';
export const ISOLATED_URL = 'https://sjwitcwhjtznextxswbm.supabase.co';
export const ISOLATED_PUBLISHABLE_KEY = 'sb_publishable_htnEJer6o6tsPW71AHWzUA_JdOO_1MM';
const PRODUCTION_PROJECT_ID = 'cuoruflxfyubjpboqprb';
const VERIFIED_DEMO_STORE = '96095952-db86-4ff1-be81-13ff4633e072';
export function assertIsolatedEndpoint(url) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.hostname !== ISOLATED_PROJECT_ID + '.supabase.co' || parsed.hostname.includes(PRODUCTION_PROJECT_ID)) {
    throw new Error('Blocked: this test may only connect to the isolated Supabase project');
  }
  return parsed.origin;
}
export async function isolatedRpc(name, accessToken, args = {}, fetcher = fetch) {
  const allowed = new Set(['staff_lamp_my_profile_v5641','staff_set_store_operating_status_v5640','public_store_operating_status_v5640','demo_public_lamp_status_v5641']);
  if (!allowed.has(name)) throw new Error('RPC not allowlisted');
  if (name === 'staff_set_store_operating_status_v5640') {
    if (!accessToken) throw new Error('Authenticated test staff token required');
    if (!['OPEN','AWAY','CLOSE'].includes(args.p_status) || args.p_store_id !== VERIFIED_DEMO_STORE) throw new Error('Invalid test store or status');
  }
  const base = assertIsolatedEndpoint(ISOLATED_URL);
  const headers = {'apikey':ISOLATED_PUBLISHABLE_KEY,'Content-Type':'application/json'};
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;
  const response = await fetcher(base + '/rest/v1/rpc/' + name,{method:'POST',headers,body:JSON.stringify(args)});
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.message || 'Isolated RPC failed');
  return payload;
}
