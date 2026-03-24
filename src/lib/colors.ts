// Zero-dependency ANSI color helpers with NO_COLOR / TTY support

const supportsColor = (): boolean => {
  if (process.env.NO_COLOR !== undefined) return false;
  if (process.env.FORCE_COLOR !== undefined) return true;
  if (typeof process.stdout.isTTY === 'boolean') return process.stdout.isTTY;
  return false;
};

const enabled = supportsColor();

const esc = (code: string) => `\x1b[${code}m`;
const wrap = (code: string, reset: string) => (s: string) =>
  enabled ? `${esc(code)}${s}${esc(reset)}` : s;

export const bold = wrap('1', '22');
export const dim = wrap('2', '22');
export const red = wrap('31', '39');
export const green = wrap('32', '39');
export const yellow = wrap('33', '39');
export const blue = wrap('34', '39');
export const cyan = wrap('36', '39');
export const gray = wrap('90', '39');

export const symbols = {
  tick: enabled ? '✔' : '+',
  cross: enabled ? '✖' : 'x',
  bullet: enabled ? '●' : '*',
  arrow: enabled ? '→' : '->',
  warning: enabled ? '⚠' : '!',
} as const;
