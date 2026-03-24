// Zero-dependency ANSI color helpers
const esc = (code: string) => `\x1b[${code}m`;
const wrap = (code: string, reset: string) => (s: string) => `${esc(code)}${s}${esc(reset)}`;

export const bold = wrap('1', '22');
export const dim = wrap('2', '22');
export const red = wrap('31', '39');
export const green = wrap('32', '39');
export const yellow = wrap('33', '39');
export const blue = wrap('34', '39');
export const cyan = wrap('36', '39');
export const gray = wrap('90', '39');

export const symbols = {
  tick: '✔',
  cross: '✖',
  bullet: '●',
  arrow: '→',
  warning: '⚠',
} as const;
