/** Reviewed official versions isolated from legacy manual/replay identities.
 * Missing/version/hash mismatch must make a formal round incomplete, never fall back. */
const PINNED = [
 ['exam-69-02','55fb46d8bf55164e','75b448336fbab17f047cd2f7e63b66b00096be59a1947813247e8562a9f449a5'],
 ['exam-69-04','f66028c033fe457f','9756c66e2e3b7a5d6adc26dea18530ecba8495088368f9ae53659a5a9d0bc5d4'],
 ['exam-69-13','8831ef75af8220c2','69affed5972c41be207dee83d6f6b68ef5e273c8c8e0129d8d6d66439137bb37'],
] as const;
/** Internal fixed aliases only, never accept user input here. */
export function officialPinnedSql(alias: 'v'|'q'): string {
 return '('+PINNED.map(([id,version,hash])=>`(${alias}.question_id='${id}' AND ${alias}.version='${version}' AND ${alias}.content_hash='${hash}')`).join(' OR ')+')';
}
export function formalCatalogSql(alias: 'v'|'q'): string {
 return `(${officialPinnedSql(alias)} OR (${alias}.is_current AND ${alias}.question_id NOT IN (${PINNED.map(([id])=>`'${id}'`).join(',')})))`;
}
