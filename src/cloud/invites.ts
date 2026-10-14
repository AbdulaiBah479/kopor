// Staff invites with one-time codes (see supabase/migrations/0007_invite_codes.sql). Joining needs the code AND
// an account made with the invited phone number, so knowing someone's number is not enough to get into a business.
import { getSupabase } from './supabase';
import { syncNow } from './sync';

async function client() {
  const sb = await getSupabase();
  if (!sb) throw new Error('err.noCloud');
  const { data } = await sb.auth.getSession();
  if (!data.session) throw new Error('errx.inviteSignIn');
  return sb;
}

/** Owner: create a code for a staff member (their row is uploaded first so the server knows them). */
export async function createInvite(orgId: string, memberId: string): Promise<string> {
  const sb = await client();
  await syncNow(orgId);
  const { data, error } = await sb.rpc('create_member_invite', { p_member: memberId });
  if (error) throw new Error(error.message);
  return data as string;
}

/** Staff: join the business that invited this phone number. Returns the business id. */
export async function claimInvite(code: string): Promise<string> {
  const sb = await client();
  const { data, error } = await sb.rpc('claim_invite', { code });
  if (error) throw new Error(error.message);
  return data as string;
}
