import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { ApiError, toApiError } from './errors';

/**
 * Call a database function and check what comes back against its schema.
 *
 * All reads and writes go through these functions rather than the tables, so the
 * rules (and Row Level Security, which still applies to them) live in the database.
 */
export async function callRpc<S extends z.ZodTypeAny>(
  supabase: SupabaseClient,
  fn: string,
  args: Record<string, unknown>,
  schema: S,
): Promise<z.infer<S>> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    const failure = toApiError(error);
    if (failure.code === 'unavailable') console.error(`[rpc] ${fn} failed: ${error.code ?? 'no code'} ${error.message}`);
    throw failure;
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    const where = parsed.error.issues[0]?.path.join('.') || '(root)';
    console.error(`[rpc] ${fn} returned an unexpected shape at ${where}`);
    throw new ApiError('invalid_response', `${fn} at ${where}`);
  }
  return parsed.data;
}
