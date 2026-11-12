import { expect, test } from "vitest";
import pkg from "../package.json" with { type: "json" };
import { BUNDLED, licenses } from "../vite.config.ts";

test("licenses() は一覧の全部の包みについて、見出しとライセンスの文を返す", () => {
  const parts = licenses().split("\n----\n\n");
  expect(parts.map((p) => p.split(" ")[0])).toEqual(BUNDLED);
  for (const p of parts)
    expect(p).toMatch(/Permission is hereby granted|SIL OPEN FONT LICENSE/);
});

test("web の dependencies と fontsource の書体は全部ライセンスの一覧に入っている", () => {
  const names = [
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.devDependencies).filter((n) =>
      n.startsWith("@fontsource/"),
    ),
  ];
  expect([...BUNDLED].sort()).toEqual(names.sort());
});
