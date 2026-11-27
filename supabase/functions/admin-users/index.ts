// Admin-only: create an instructor login. Creating a login needs the service key, which must never be
// in the browser, so the admin website calls this function. Everything else (approval, details,
// edit, delete) runs in the database as the signed-in admin and is checked there again.
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

type CreateBody = {
  action: 'create_instructor';
  email: string;
  password: string;
  full_name: string;
  employee_id?: string;
  department?: string;
  contact_number?: string;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Sign in first' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  // The caller's own session: every database call below is checked as them.
  const asAdmin = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = await asAdmin.rpc('is_admin');
  if (admin.error || admin.data !== true) return json({ error: 'Only administrators can do this.' }, 403);

  let body: CreateBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid request' }, 400);
  }
  if (body.action !== 'create_instructor') return json({ error: 'Unknown action' }, 400);

  const email = String(body.email ?? '').trim().toLowerCase();
  const password = String(body.password ?? '');
  const fullName = String(body.full_name ?? '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!fullName) return json({ error: 'Enter the instructor’s full name.' }, 400);
  if (password.length < 8 || !/[a-z]/i.test(password) || !/[0-9]/.test(password)) {
    return json({ error: 'The password needs at least 8 characters with letters and numbers.' }, 400);
  }

  const service = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
  const created = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // the admin vouches for the address; the instructor can sign in right away
    user_metadata: { full_name: fullName },
  });
  if (created.error || !created.data.user) {
    const msg = created.error?.message ?? 'Could not create the account.';
    return json({ error: /already/i.test(msg) ? 'An account with this email already exists. Find it in Users and change its role to Instructor.' : msg }, 400);
  }
  const id = created.data.user.id;

  // Approve as instructor and save the details — as the admin, so it is checked and logged.
  const role = await asAdmin.rpc('admin_set_role', { _user_id: id, _role: 'instructor' });
  const details = role.error
    ? role
    : await asAdmin.rpc('admin_save_instructor', {
        _user_id: id,
        _full_name: fullName,
        _employee_id: body.employee_id ?? '',
        _department: body.department ?? '',
        _contact_number: body.contact_number ?? '',
      });
  if (details.error) {
    await service.auth.admin.deleteUser(id); // undo: no half-made accounts
    return json({ error: details.error.message }, 400);
  }
  return json({ id, email });
});
