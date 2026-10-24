import type { MessageEntry } from "../index.ts";
import type { git as zhCN } from "../zh-CN/git.ts";

export const git = {
  "draft.worktree": "Start in a separate worktree",
  "draft.title": "Do this task in its own worktree (new studio/… branch); your main folder stays untouched",
  "draft.on": "new worktree",
  "draft.setup": "Will run {script} on creation",
  "draft.blocked": "Worktree unavailable: {reason}",
  "setup.title": "Run this project's setup script?",
  "setup.body":
    "{script} comes from this project's repository and runs in the new worktree with your permissions. Only run scripts you trust.",
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

  "menu.commit": "Commit",
  "menu.push": "Push",
  "menu.pr": "Create PR",
  "menu.merge": "Merge back into {base}",
  "menu.discard": "Discard worktree",
  "menu.cleanup": "Clean up orphan worktrees",

  "commit.title": "Commit changes",
  "commit.message": "Commit message",
  "commit.stageAll": "Stage all changes first",
  "commit.confirm": "Commit",
  "commit.review": "Review changes",
  "commit.done": "Committed {commit}",
  "commit.nothing": "Nothing to commit. Tick “Stage all changes first” or stage files in review.",
  "commit.failed": "git rejected the commit",
  "commit.amended": "Amended the previous commit, now {commit}",
  "commit.noPrevious": "There is no commit yet, so there is nothing to amend.",
  "generate.nothing": "Nothing is staged. Stage the files to commit first.",
  "generate.noModel":
    "omp has no model for commit messages. Pick a model for the commit (or smol) role in settings and set its key.",
  "generate.split": "omp suggests splitting these changes into {count} commits; only the first message was filled in.",
  "generate.failed": "Could not generate a commit message",

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
  "pr.badge": "Open pull request #{number} in the browser",

  "merge.done": "Merged into {base}",
  "merge.nothing": "No new commits to merge.",
  "merge.conflictTitle": "Merge conflict",
  "merge.conflictBody": "The merge was undone and nothing changed.",
  "merge.blocked.worktree_dirty": "The worktree has uncommitted changes. Commit or discard them first.",
  "merge.blocked.base_dirty":
    "Your main folder has uncommitted changes the merge could overwrite. Deal with them first.",
  "merge.blocked.base_not_checked_out": "The main folder is not on {base} (it is on {current}). Switch back first.",
  "merge.detached": "detached HEAD",

  "discard.title": "Discard this worktree?",
  "discard.body":
    "Deletes branch {branch} and the worktree folder; uncommitted and unmerged changes are lost and the task is archived. This cannot be undone.",
  "discard.confirm": "Discard",
  "discard.done": "Worktree discarded",

  "cleanup.title": "Clean up orphan worktrees",
  "cleanup.none": "No orphan worktrees.",
  "cleanup.removed": "Removed",
  "cleanup.kept": "Kept",
  "cleanup.dirty": "has uncommitted changes",
  "cleanup.unmerged": "has unmerged commits",
} satisfies Record<keyof typeof zhCN, MessageEntry>;
