// 值变成 null 后继续返回上一个非空值：配合 Reveal / usePresence，收起动画放完之前内容不能先消失。
import { useRef } from "react";

export function useHeld<T>(value: T | null): T | null {
  const ref = useRef(value);
  if (value !== null) ref.current = value;
  return value ?? ref.current;
}
