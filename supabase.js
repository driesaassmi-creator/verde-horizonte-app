/* Verde Horizonte — Supabase configuratie */
const SUPABASE_URL = 'https://jfeicdnntthbxvthsriz.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HJ_017xez-xq_oA76an6Kw_eb6b0-QL';
// window.supabase is de UMD-bibliotheek van de CDN. De client heet
// supabaseClient om een naamconflict met die bibliotheek te voorkomen.
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
