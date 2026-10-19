import type { MessageEntry } from "../index.ts";
import type { git as zhCN } from "../zh-CN/git.ts";

export const git = {
  "chip.label": "Worktree",
  "chip.title": "Do this task in its own git worktree: a new studio/… branch, your main folder stays untouched",
  "chip.setup": "Will run {script} on creation",
  "chip.blocked": "Worktree unavailable: {reason}",
  "setup.title": "Run this project's setup script?",
  "setup.body":
    "{script} comes from this project's repository. It will run in the new worktree with your permissions. Only run scripts you trust. You will be asked again if the script changes.",
  "setup.confirm": "Run and create",
  "setup.declined": "The worktree was not created.",

  "err.notGit": "This project folder is not a git repository.",
  "err.notRoot": "The project folder must be the repository root.",
  "err.noCommits": "The repository has no commits yet. Commit once first.",
  "err.detached": "The repository is on a detached HEAD. Check out a branch first.",
  "err.gitMissing": "git was not found. Install it and add it to PATH.",
  "err.setupFailed": "The worktree setup script failed; the worktree was rolled back.",

  "bar.menu": "Git actions",
  "bar.branch": "Branch {branch}",
  "bar.worktree": "Worktree · based on {base}",
  "bar.changed": { one: "{count} changed file", other: "{count} changed files" },
  "bar.untracked": { one: "{count} untracked file", other: "{count} untracked files" },
  "bar.ahead": { one: "{count} commit ahead", other: "{count} commits ahead" },
  "row.worktree": "Worktree branch {branch}",

  "menu.review": "Review changes",
  "menu.commit": "Commit…",
  "menu.push": "Push",
  "menu.pr": "Create pull request…",
  "menu.merge": "Merge back into {base}",
  "menu.discard": "Discard worktree…",
  "menu.cleanup": "Clean up orphan worktrees",

  "commit.title": "Commit changes",
  "commit.message": "Commit message",
  "commit.stageAll": "Stage all changes first",
  "commit.confirm": "Commit",
  "commit.done": "Committed {commit}",
  "commit.nothing": "Nothing to commit. Tick “Stage all changes first” or stage files in review.",
  "commit.failed": "git rejected the commit",

  "push.done": "Pushed to {remote}/{branch}",
  "push.noRemote": "No remote is configured, so there is nowhere to push.",
  "push.detached": "On a detached HEAD: there is no branch to push.",
  "push.rejected":
    "The remote has commits you don't have, so nothing was pushed (never force-pushes). Bring the remote changes in first.",
  "push.failed": "Push failed",

  "pr.title": "Create pull request",
  "pr.titleField": "Title",
  "pr.body": "Description",
  "pr.confirm": "Push and create",
  "pr.done": "Pull request created",
  "pr.open": "Open",
  "pr.ghUnavailable": "The gh command was not found. Install GitHub CLI and add it to PATH to create PRs.",
  "pr.ghUnauthenticated": "gh is not signed in. Run gh auth login in a terminal and try again.",
  "pr.failed": "Creating the PR failed",

  "merge.done": "Merged into {base}",
  "merge.nothing": "No new commits to merge.",
  "merge.conflictTitle": "Merge conflict",
  "merge.conflictBody":
    "The merge was undone; neither your main folder nor the worktree was changed. Resolve the files below (the agent can do it) and merge again.",
  "merge.blocked.worktree_dirty": "The worktree has uncommitted changes. Commit or discard them first.",
  "merge.blocked.base_dirty":
    "Your main folder has uncommitted changes the merge could overwrite. Deal with them first.",
  "merge.blocked.base_not_checked_out": "The main folder is not on {base} (it is on {current}). Switch back first.",
  "merge.detached": "detached HEAD",

  "discard.title": "Discard this worktree?",
  "discard.body":
    "This deletes branch {branch} and the worktree folder. Uncommitted and unmerged changes in it are lost, and the task is archived. This cannot be undone.",
  "discard.confirm": "Discard",
  "discard.done": "Worktree discarded",

  "cleanup.title": "Clean up orphan worktrees",
  "cleanup.none": "No orphan worktrees.",
  "cleanup.removed": "Removed",
  "cleanup.kept": "Kept",
  "cleanup.dirty": "has uncommitted changes",
  "cleanup.unmerged": "has unmerged commits",
  "cleanup.unregistered": "unknown to git or not a studio/ branch",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
