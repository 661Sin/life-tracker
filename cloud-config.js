// ---------- Cloud (Supabase) settings ----------
// Both values are PUBLIC on purpose: the publishable key only lets the app talk
// to Supabase; what each person can read or write is decided by Row Level
// Security in the database (supabase/schema.sql). NEVER put the service_role /
// secret key in this repo.
const CLOUD_CONFIG = {
  url: "https://disslhtvznewscuqpjhs.supabase.co",
  key: "sb_publishable_bXed-tHxIiWW7G-TI6SkrQ_Fn0HenSi",
  authKey: "lifeTracker.auth",                                // where the login is remembered on this device
  siteUrl: "https://661sin.github.io/life-tracker/",           // password-reset emails link back here
};

// Before anything is drawn: not logged in on this device → the app stays hidden
// behind the log-in screen (cloud.js shows it). Reset links arrive logged in.
try {
  if (!localStorage.getItem(CLOUD_CONFIG.authKey) && !/access_token|error_code/.test(location.hash)) {
    document.documentElement.classList.add("signed-out");
  }
} catch (e) { /* storage blocked: cloud.js decides */ }
