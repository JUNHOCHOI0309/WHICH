import { describe, expect, it } from "vitest";

import { toast, type ToastInput } from "./toast";

describe("mobile toast event bus", () => {
  it("delivers active notifications and replays a notification emitted between screens", () => {
    const active: ToastInput[] = [];
    const unsubscribe = toast.subscribe((input) => active.push(input));

    toast.success("로그인에 성공했습니다.");
    expect(active).toEqual([{ message: "로그인에 성공했습니다.", tone: "success" }]);

    unsubscribe();
    toast.success("로그아웃했습니다.");

    const replayed: ToastInput[] = [];
    const stopReplay = toast.subscribe((input) => replayed.push(input));
    expect(replayed).toEqual([{ message: "로그아웃했습니다.", tone: "success" }]);
    stopReplay();
  });
});
