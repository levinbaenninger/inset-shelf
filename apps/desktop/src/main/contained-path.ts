import path from "node:path";

/**
 * `name` inside `root`, or null when joining them would leave it (a name
 * with "..", a separator that climbs, an absolute name).
 */
export const containedPath = (root: string, name: string): string | null => {
  const base = path.resolve(root);
  const target = path.resolve(base, name);
  const relative = path.relative(base, target);

  return relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
    ? target
    : null;
};
