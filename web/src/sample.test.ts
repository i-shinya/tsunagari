import { expect, test } from "vitest";
import { parse } from "../../src/markdown.ts";
import sample from "./sample.json" with { type: "json" };

test("見本の p の数は見本の文章の境目の数と同じ", () => {
  expect(sample.ps).toHaveLength(parse(sample.text, false).boundaries.length);
});
