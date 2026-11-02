export function multipleAnswerDetails(value: string, expectedParts: string[]) {
  const norm=function(s: string){return s.normalize('NFC').replace(/\s+/g,'');},expected=expectedParts.map(norm),raw=value.trim();
  let given: string[];
  if (/[,，]/.test(raw)) given=raw.split(/[,，]/).map(norm);
  else {
    // Whitespace can separate complete canonical items; never guess aliases or remove punctuation.
    const words=raw.split(/\s+/),paths: string[][]=[];
    function walk(at: number,parts: string[]){if(paths.length>1||parts.length>expected.length)return;if(at===words.length){paths.push(parts);return;}for(let end=at+1;end<=words.length;end++){const part=norm(words.slice(at,end).join(' '));if(expected.indexOf(part)>=0)walk(end,parts.concat([part]));}}
    walk(0,[]);given=paths.length===1?paths[0]:[norm(raw)];
  }
  const unique=Array.from(new Set(given)),matched=expected.filter(function(p){return unique.indexOf(p)>=0;}),missing=expectedParts.filter(function(p){return unique.indexOf(norm(p))<0;}),extra=unique.filter(function(p){return expected.indexOf(p)<0;}),duplicate=unique.length!==given.length;
  return {correct:!duplicate&&!extra.length&&!missing.length&&given.length===expected.length,matched:matched.length,total:expected.length,missing:missing,partial:!duplicate&&!extra.length&&matched.length>0&&missing.length>0};
}
