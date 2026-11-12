import { expect, test } from "vitest";
import {
  forget,
  forgotten,
  gpuTrying,
  markGpu,
  read,
  save,
  unmarkGpu,
  usable,
} from "./keep.ts";

class Box implements Storage {
  map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  clear() {
    this.map.clear();
  }
  getItem(k: string) {
    return this.map.get(k) ?? null;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  setItem(k: string, v: string) {
    this.map.set(k, v);
  }
}
class Broken extends Box {
  override getItem(): never {
    throw new DOMException("", "SecurityError");
  }
  override setItem(): never {
    throw new DOMException("", "QuotaExceededError");
  }
  override removeItem(): never {
    throw new DOMException("", "SecurityError");
  }
}

type Case = {
  box: Storage;
  act: (s: Storage) => boolean;
  want: string | undefined;
  ok: boolean;
};
const CASES: [string, Case][] = [
  [
    "残すと開き直しても戻る",
    {
      box: new Box(),
      act: (s) => save(s, true, "本文"),
      want: "本文",
      ok: true,
    },
  ],
  [
    "残すを選んでいなければ書かない",
    {
      box: new Box(),
      act: (s) => save(s, false, "本文"),
      want: undefined,
      ok: true,
    },
  ],
  [
    "消すと何も無い",
    {
      box: new Box(),
      act: (s) => {
        save(s, true, "本文");
        forget(s);
        return true;
      },
      want: undefined,
      ok: true,
    },
  ],
  [
    "Storage が投げても投げず、書けなかったと返す",
    {
      box: new Broken(),
      act: (s) => {
        forget(s);
        return !save(s, true, "本文");
      },
      want: undefined,
      ok: false,
    },
  ],
];

test.each(CASES)("%s", (_, { box, act, want, ok }) => {
  expect(act(box)).toBe(true);
  expect(read(box)).toBe(want);
  expect(usable(box)).toBe(ok);
  expect(box.length).toBe(want === undefined ? 0 : 1);
});

test("GPU の印は書くと残り、消すと無くなる", () => {
  const box = new Box();
  expect(gpuTrying(box, 0)).toBe(false);
  markGpu(box, 0);
  expect(gpuTrying(box, 0)).toBe(true);
  unmarkGpu(box);
  expect(gpuTrying(box, 0)).toBe(false);
});

test.each([
  ["7 日の直前は残っている", 7 * 864e5 - 1, true],
  ["7 日で切れる", 7 * 864e5, false],
])("GPU の印は%s", (_, now, want) => {
  const box = new Box();
  markGpu(box, 0);
  expect(gpuTrying(box, now)).toBe(want);
});

test("Storage が投げても GPU の印は投げず、無い扱いにする", () => {
  const box = new Broken();
  markGpu(box, 0);
  unmarkGpu(box);
  expect(gpuTrying(box, 0)).toBe(false);
});

test.each([
  ["この鍵が消えた", { key: "tsunagari:text", newValue: null }, true],
  ["全部消えた", { key: null, newValue: null }, true],
  ["この鍵が書き替わった", { key: "tsunagari:text", newValue: "本文" }, false],
  ["ほかの鍵が消えた", { key: "other", newValue: null }, false],
])("別のタブで%sとき forgotten は %s", (_, e, want) => {
  expect(forgotten(e)).toBe(want);
});
