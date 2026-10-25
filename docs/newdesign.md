
use : C:\projects\sheepsidebay_crm_ver2
Don't push. Stop for my review.

Set up a separate Git worktree for the minicrm redesign. Setup only; don't start designing yet.

1. Inspect the current repository path, branch, git status, recent commits and existing worktrees. If there are uncommitted changes, the current branch isn't main, or the base is unclear, stop and report. I make my own commits.
2. If main is clean, create a new branch named redesign and a linked worktree at C:\projects\minicrm-redesign from main's current commit. If that branch or folder already exists, stop rather than overwrite or reuse it.
3. Verify the branch and status in both folders, and report the exact base commit and new folder path.

Do not switch branches in the original folder. No commits, pushes, resets, clean, stash, git init or clone. Preserve all existing work. Don't start Docker, services, deployment or the redesign.

Stop after verification. I'll open the new folder in a separate Kimi session afterward.