import type { MessageEntry } from "../index.ts";
import type { omp as zhCN } from "../zh-CN/omp.ts";

export const omp = {
  finding: "Looking for omp…",
  found: "Found omp {version} ({source})",
  "source.other": "managed by {name}",
  "source.studio": "managed by omp-studio",
  "source.user": "installed by you",
  downloading: "Downloading omp {version}…",
  "downloading.latest": "Looking for the latest version…",
  progress: "{done} of {total} downloaded",
  verifying: "Verifying…",
  verifyFailed: "The file failed verification and was discarded.",
  "takeover.title": "Found a script-based omp",
  "takeover.body":
    "omp-studio can't launch script-based installs (such as npm). It can install an official copy first on your user PATH; your existing one stays.",
  "takeover.exeTitle": "Found an omp you installed yourself",
  "takeover.exeBody":
    "omp-studio can install an official copy and put it first on your user PATH. Your existing install stays as is.",
  "takeover.otherTitle": "Found an omp managed by {name}",
  "takeover.otherBody":
    "omp-studio can install an official copy and put it first on your user PATH. {name}'s copy stays, just no longer first.",
  // macOS / Linux：不改 PATH（没有用户 PATH 可写），omp-studio 装的那份只给它自己用。
  "takeover.bodyStudioOnly":
    "omp-studio can't launch script-based installs (such as npm). It can install an official copy for its own use; your existing one stays.",
  "takeover.exeBodyStudioOnly":
    "omp-studio can install an official copy for its own use. Your existing install, and the omp your terminal runs, stay as they are.",
  "takeover.otherBodyStudioOnly":
    "omp-studio can install an official copy for its own use. {name}'s copy, and the omp your terminal runs, stay as they are.",
  "takeover.keepOther": "Keep using {name}'s",
  "takeover.where": "Location: {path}",
  "takeover.yes": "Let omp-studio manage it",
  "takeover.no": "Cancel",
  "takeover.keep": "Keep using mine",
  "takeover.declined": "This kind of install can't be used right now.",
  "unusable.title": "Can't start this omp",
  reconsider: "Choose again",
  addPath: "Terminal",
  "addPath.note": "Restart open terminals to pick it up",
  "addPath.yes": "Add to PATH",
  "addPath.failed": "Couldn't change your user PATH: {message}",
  outdated: "omp {current} is too old. Version {min} or newer is required.",
  upgrade: "Upgrade",
  upgrading: "Upgrading…",
  upgradeDone: "Upgrade finished.",
  upgradeFailed: "The upgrade didn't succeed (exit code {code}).",
  updateByManager: "Update omp from {name}.",
  updatedTo: "Updated to {version}. New tasks will use it",
  checkUpdate: "Check for updates",
  checkFailed: "Couldn't check for updates: {message}",
  upToDate: "You're up to date",
  newVersion: "New version {version} available",
  "autoUpdate.noteOther": "New versions are never installed automatically",
  path: "omp path",
  "error.title": "Couldn't start omp",
  "error.discover": "Couldn't find a usable omp.",
  "error.download": "Couldn't get omp from the build service. Check your network and try again.",
  "error.verify": "The downloaded file failed verification and was discarded. Trying again downloads it again.",
  "error.install": "Couldn't put omp into its install folder.",
  "error.path": "Couldn't change your user PATH.",
  "error.details": "Show details",
  retry: "Try again",
  openSettings: "Open settings",
  "missing.title": "omp is required",
  "missing.body":
    "Download the official build from {source} (about {size}); it's added to your user PATH and kept updated.",
  "missing.bodyNoSize": "Download the official build from {source}; it's added to your user PATH and kept updated.",
  "missing.bodyStudioOnly":
    "Download the official build from {source} (about {size}) for omp-studio's own use; it's kept updated.",
  "missing.bodyNoSizeStudioOnly":
    "Download the official build from {source} for omp-studio's own use; it's kept updated.",
  "missing.titleVersion": "omp {version} is required",
  install: "Download and install",
  recheck: "I've installed it, check again",
  cancelDownload: "Cancel download",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
