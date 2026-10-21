/* Verde Horizonte — Supabase configuratie */
const SUPABASE_URL = 'https://jfeicdnntthbxvthsriz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HJ_017xez-xq_oA76an6Kw_eb6b0-QL';
// Gebruik window.supabase (de UMD-bibliotheek) om een TDZ-conflict met de
// const-declaratie hieronder te vermijden.
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
