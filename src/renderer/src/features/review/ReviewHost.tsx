// App 外壳里挂一个：评审打开时渲染 ReviewView；选中的任务变了（切到别的任务、被删除）就自动退出。
import { useEffect } from "react";
import { closeReview, useReviewTaskId } from "../../store/review-store.ts";
import { useSelectedTaskId } from "../../store/index.ts";
import { ReviewView } from "./ReviewView.tsx";

export function ReviewHost() {
  const reviewTaskId = useReviewTaskId();
  const selected = useSelectedTaskId();
  const stale = reviewTaskId !== null && reviewTaskId !== selected;
  useEffect(() => {
    if (stale) closeReview();
  }, [stale]);
  return reviewTaskId !== null && !stale ? <ReviewView taskId={reviewTaskId} /> : null;
}
