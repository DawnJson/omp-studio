// App 外壳里挂一个：评审打开时渲染 ReviewView；选中的任务变了（切到别的任务、被删除）就自动退出。
import { useEffect, useRef } from "react";
import { closeReview, useReviewTaskId } from "../../store/review-store.ts";
import { useSelectedTaskId } from "../../store/index.ts";
import { usePresence } from "../../ui/presence.ts";
import { ReviewView } from "./ReviewView.tsx";

export function ReviewHost() {
  const reviewTaskId = useReviewTaskId();
  const selected = useSelectedTaskId();
  const stale = reviewTaskId !== null && reviewTaskId !== selected;
  useEffect(() => {
    if (stale) closeReview();
  }, [stale]);
  const open = reviewTaskId !== null && !stale;
  const presence = usePresence(open, "fade");
  // 关闭后留着最后一个任务的评审放完退出动画。
  const lastTaskId = useRef(reviewTaskId);
  if (reviewTaskId !== null) lastTaskId.current = reviewTaskId;
  const shownTaskId = open ? reviewTaskId : lastTaskId.current;
  return presence.mounted && shownTaskId !== null ? (
    <ReviewView taskId={shownTaskId} open={open} exit={presence.exitProps} />
  ) : null;
}
