export function sequenceNumbersMatch(value: string, expectedParts: string[]): boolean {
  const expected = expectedParts.map(function(part: string) { const s=part.normalize('NFKC'); return /^[1-9][0-9]*$/.test(s)?Number(s):null; });
  if (!expected.length || expected.some(function(n: number | null){return n===null||n>20;})) return false;
  const allowed=new Set<number | null>(expected),single=expected.every(function(n: number | null){return n!==null&&n<10;}),tokens: number[]=[],chunks=value.normalize('NFC').trim().split(/(?:\s+|[,，→⇒➜➔]|->)+/);
  if (!chunks.length || chunks.some(function(s){return !s;})) return false;
  for (let i=0;i<chunks.length;i++) {
    const chunk=chunks[i],pieces=chunk.match(/[①-⑳]|[0-9]+/g);
    if (!pieces || pieces.join('')!==chunk) return false;
    for (let j=0;j<pieces.length;j++) {
      const piece=pieces[j],normalized=piece.normalize('NFKC');
      if (/^[①-⑳]$/.test(piece)) tokens.push(Number(normalized));
      else if (single) { if(!/^[1-9]+$/.test(piece))return false;tokens.push(...piece.split('').map(Number)); }
      else { if(!/^[1-9][0-9]*$/.test(piece)||!allowed.has(Number(piece)))return false;tokens.push(Number(piece)); }
    }
  }
  return tokens.length===expected.length&&tokens.every(function(n,k){return allowed.has(n)&&n===expected[k];});
}
