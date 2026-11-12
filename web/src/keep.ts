// docs/design/web.md「入口」参照
const KEY = "tsunagari:text";

export function read(s: Storage): string | undefined {
  try {
    return s.getItem(KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/** 残すを選んでいれば書く。選んでいないか書けたら true */
export function save(s: Storage, chosen: boolean, text: string): boolean {
  if (!chosen) return true;
  try {
    s.setItem(KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function forget(s: Storage): void {
  try {
    s.removeItem(KEY);
  } catch {}
}

const GPU = "tsunagari:gpu";
/** docs/design/web.md「backend の選び方」参照 */
export function markGpu(s: Storage, now: number): void {
  try {
    s.setItem(GPU, String(now));
  } catch {}
}

export function unmarkGpu(s: Storage): void {
  try {
    s.removeItem(GPU);
  } catch {}
}

export function gpuTrying(s: Storage, now: number): boolean {
  try {
    const at = s.getItem(GPU);
    return at !== null && now - Number(at) < 7 * 864e5;
  } catch {
    return false;
  }
}

/** 別のタブで鍵が消えたときの storage イベントなら true */
export const forgotten = (e: Pick<StorageEvent, "key" | "newValue">) =>
  (e.key === KEY || e.key === null) && e.newValue === null;

/** 試しに書いて消せれば true */
export function usable(s: Storage): boolean {
  const probe = `${KEY}:probe`;
  try {
    s.setItem(probe, "");
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}
