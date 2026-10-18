// 文件树：已暂存 / 未暂存 / 未跟踪三组，一个文件两侧都有改动时在两组各出现一次。点一行看那一侧的 diff。
import type { GitChangeKind } from "../../../../shared/git.ts";
import type { ReviewGroup } from "../../../../shared/ui/review-model.ts";
import type { MessageKey } from "../../../../shared/i18n/index.ts";
import { useT } from "../../i18n/use-t.ts";

const KIND: Record<GitChangeKind, { letter: string; label: MessageKey }> = {
  added: { letter: "A", label: "review.kindAdded" },
  modified: { letter: "M", label: "review.kindModified" },
  deleted: { letter: "D", label: "review.kindDeleted" },
  renamed: { letter: "R", label: "review.kindRenamed" },
  copied: { letter: "C", label: "review.kindCopied" },
  typechange: { letter: "T", label: "review.kindTypechange" },
  untracked: { letter: "U", label: "review.kindUntracked" },
  conflicted: { letter: "!", label: "review.kindConflicted" },
};

const GROUP_LABEL: Record<ReviewGroup["area"], MessageKey> = {
  staged: "review.groupStaged",
  unstaged: "review.groupUnstaged",
  untracked: "review.groupUntracked",
};

function splitPath(path: string): { dir: string; name: string } {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? { dir: "", name: path } : { dir: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

export function FileTree({
  groups,
  selectedKey,
  onSelect,
}: {
  groups: readonly ReviewGroup[];
  selectedKey: string | null;
  onSelect(key: string): void;
}) {
  const t = useT();
  return (
    <nav className="rv-tree" aria-label={t("review.files")} data-testid="review-tree">
      {groups.map((group) => (
        <section key={group.area} className="rv-group" data-area={group.area} data-testid="review-group">
          <h3 className="rv-group-title">
            <span>{t(GROUP_LABEL[group.area])}</span>
            <span className="rv-group-count">{group.entries.length}</span>
          </h3>
          <ul>
            {group.entries.map((entry) => {
              const { dir, name } = splitPath(entry.path);
              const kind = KIND[entry.kind];
              return (
                <li key={entry.key}>
                  <button
                    type="button"
                    className="rv-file-row"
                    data-testid="review-file"
                    data-path={entry.path}
                    data-area={entry.area}
                    aria-current={entry.key === selectedKey ? "true" : undefined}
                    title={entry.path}
                    onClick={() => onSelect(entry.key)}
                  >
                    <span className="rv-kind" data-kind={entry.kind} role="img" aria-label={t(kind.label)}>
                      {kind.letter}
                    </span>
                    <span className="rv-file-text">
                      <span className="rv-dir">{dir}</span>
                      <span className="rv-name">{name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </nav>
  );
}
