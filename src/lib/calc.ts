// Tiny safe calculator for amount entry ("300+250", "12x50", "1,200-150"). No eval.
// Supports + − × ÷ with normal precedence and k/m suffixes. Returns null for an incomplete expression.
export function evaluate(input: string): number | null {
  const src = input.replace(/,/g, '').replace(/\s+/g, '').replace(/[xX*×]/g, '×').replace(/[/÷]/g, '÷').replace(/[−–]/g, '-');
  if (!src) return null;
  const tokens = src.match(/(\d+(?:\.\d*)?|\.\d+)[kKmM]?|[-+×÷]/g);
  if (!tokens || tokens.join('') !== src) return null;
  const nums: number[] = [];
  const ops: string[] = [];
  let expectNumber = true;
  for (const tk of tokens) {
    if (/^[-+×÷]$/.test(tk)) {
      if (expectNumber) return null;
      ops.push(tk);
      expectNumber = true;
    } else {
      if (!expectNumber) return null;
      let v = parseFloat(tk);
      if (/[kK]$/.test(tk)) v *= 1e3; else if (/[mM]$/.test(tk)) v *= 1e6;
      nums.push(v);
      expectNumber = false;
    }
  }
  if (expectNumber) return null;
  // First pass: × and ÷
  const n2: number[] = [nums[0]];
  const o2: string[] = [];
  ops.forEach((op, i) => {
    const b = nums[i + 1];
    if (op === '×') n2[n2.length - 1] *= b;
    else if (op === '÷') n2[n2.length - 1] = b === 0 ? NaN : n2[n2.length - 1] / b;
    else { o2.push(op); n2.push(b); }
  });
  const out = o2.reduce((acc, op, i) => (op === '+' ? acc + n2[i + 1] : acc - n2[i + 1]), n2[0]);
  return Number.isFinite(out) ? Math.round(out * 100) / 100 : null;
}

export const hasOperator = (s: string) => /\d\s*[-+×÷xX*/−]\s*\d/.test(s);
