/**
 * Reply prefill in the plaintext convention other MeshCore clients use:
 *
 *   @[Name]
 *   >first 10 chars of the original..
 *   <your reply>
 *
 * A leading "@[X]" mention in the original is dropped before quoting.
 * Characters are counted as code points so an emoji is not split in half.
 */
const QUOTE_CHARS = 10;
const LEADING_MENTION = /^@\[[^\]]+\]\s*/;

export function buildReplyText(mentionName: string, originalBody: string): string {
  const source = originalBody.replace(LEADING_MENTION, '');
  const chars = Array.from(source);
  const preview = chars.slice(0, QUOTE_CHARS).join('');
  const suffix = chars.length > QUOTE_CHARS ? '..' : '';
  return `@[${mentionName}]\n>${preview}${suffix}\n`;
}
