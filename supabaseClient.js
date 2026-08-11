import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const configurado = !SUPABASE_URL.startsWith('COLE_AQUI') && !SUPABASE_ANON_KEY.startsWith('COLE_AQUI');

export const supabase = configurado ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
