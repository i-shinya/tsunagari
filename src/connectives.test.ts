import { expect, test } from "vitest";
import { headWord } from "./connectives.ts";

test.each([
  {
    s: "しかし、雨が降った。",
    want: { word: "しかし", rels: ["逆接"], rest: "雨が降った。" },
  },
  {
    s: "しかしながら雨が降った。",
    want: { word: "しかしながら", rels: ["逆接"], rest: "雨が降った。" },
  },
  {
    s: "ただ、少し遅れた。",
    want: { word: "ただ", rels: ["逆接", "補足"], rest: "少し遅れた。" },
  },
  { s: "またの機会にする。", want: null },
  { s: "実際に試した。", want: null },
  {
    s: "実は、房の根元に近いほうから赤くなった。",
    want: {
      word: "実は",
      rels: ["補足"],
      rest: "房の根元に近いほうから赤くなった。",
    },
  },
  {
    s: "実は雨だった。",
    want: { word: "実は", rels: ["補足"], rest: "雨だった。" },
  },
  { s: "実は房の根元に近いほうから赤くなった。", want: null },
  { s: "雨が降った。", want: null },
])("headWord($s) は $want を返す", ({ s, want }) => {
  expect(headWord(s)).toEqual(want);
});
