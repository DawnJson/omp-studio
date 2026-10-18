import type { MessageEntry } from "../index.ts";
import type { login as zhCN } from "../zh-CN/login.ts";

export const login = {
  providers: "Providers",
  signIn: "Sign in",
  signOut: "Sign out",
  signedIn: "Signed in · {account}",
  notSignedIn: "Not signed in",
  viaEnv: "Using an environment variable or config key",
  keyInApp: "API key set",
  unavailable: "Unavailable right now",
  opening: "Opening your browser…",
  fallback: "If your browser didn't open, copy this link:",
  reopen: "Open the browser again",
  pasteCode: "Paste the authorization code",
  submit: "Submit",
  cancel: "Cancel",
  terminalOnly: "This provider has to be set up in the terminal: run omp, then type /login.",
  copyCommand: "Copy command",
  chooseAccount: "Choose an account to sign out",
  failed: "Sign-in didn't complete.",
  refreshFailed: "Couldn't refresh; showing the last result: {message}",
  loadFailed: "Couldn't load account info: {message}",
  empty: "No providers available",
  apiKey: "API key",
  "apiKey.set": "Set API key",
  "apiKey.placeholder": "Paste an API key",
  "apiKey.save": "Save",
  "apiKey.clear": "Clear API key",
  "apiKey.note":
    "The key is encrypted with your system credentials and stored on this PC. It isn't written to omp's config, so the terminal version can't see it.",
  "apiKey.failed": "Couldn't save the API key: {message}",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
