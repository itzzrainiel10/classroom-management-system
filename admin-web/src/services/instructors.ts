import { supabase } from './supabase';

export type InstructorInput = { full_name: string; employee_id: string; department: string; contact_number: string };

/** Turns an Edge Function / RPC failure into the readable message the server sent. */
async function messageOf(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response })?.context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      const body = (await ctx.json()) as { error?: string };
      if (body?.error) return body.error;
    } catch {
      /* not JSON */
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/** Creates the login (server-side, admin only), approves it as an instructor and saves the details. */
export async function createInstructor(v: InstructorInput & { email: string; password: string }) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body: { action: 'create_instructor', ...v } });
  if (error) throw new Error(await messageOf(error));
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as { id: string; email: string };
}

export async function saveInstructor(userId: string, v: InstructorInput) {
  const { error } = await supabase.rpc('admin_save_instructor', {
    _user_id: userId,
    _full_name: v.full_name,
    _employee_id: v.employee_id,
    _department: v.department,
    _contact_number: v.contact_number,
  });
  if (error) throw new Error(error.message);
}

/** Deletes the instructor's account (refused while they still teach this semester). */
export async function deleteInstructor(userId: string) {
  const { data, error } = await supabase.rpc('admin_delete_instructor', { _user_id: userId });
  if (error) throw new Error(error.message);
  return data as { name: string; classes_removed: number };
}

/** A readable temporary password: 3 words-ish letters + digits, e.g. "Cvsu-Teach-4821". */
export function tempPassword() {
  const words = ['Cvsu', 'Green', 'Gold', 'Truth', 'Class', 'Teach', 'Learn', 'Excel', 'Serve', 'Bright'];
  const pick = () => words[crypto.getRandomValues(new Uint32Array(1))[0] % words.length];
  const num = 1000 + (crypto.getRandomValues(new Uint32Array(1))[0] % 9000);
  return `${pick()}-${pick()}-${num}`;
}
