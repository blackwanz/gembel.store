// assets/supabaseClient.js
//
// Shared Supabase client used by every page on this site. The anon key
// below is the public/anon key -- it's meant to be embedded in client-side
// code like this (it has no privileges beyond what Row Level Security
// grants); it is NOT the service_role key, which must never appear here.

const SUPABASE_URL = 'https://pufzmeakhiosibrxdfpp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1ZnptZWFraGlvc2licnhkZnBwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM0NTU3OTEsImV4cCI6MjA5OTAzMTc5MX0.Cs1ESdKYrAEdP9GSrtEnri3uBhdvi5gKEHlvZmTY76A';

window.supabase = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
