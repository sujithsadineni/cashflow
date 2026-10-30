/**
 * Shared image-upload validation — any feature that lets the
 * household attach a photo to something (an account's card image, a
 * contact's photo) uses this same check. A short allow-list verified
 * by magic bytes, not just the file extension — same belt-and-braces
 * pattern as the statement upload's PDF check.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_SIGNATURES = {
  '.png': [0x89, 0x50, 0x4e, 0x47],
  '.jpg': [0xff, 0xd8, 0xff],
  '.jpeg': [0xff, 0xd8, 0xff],
  '.webp': [0x52, 0x49, 0x46, 0x46], // 'RIFF'; good enough at this trust level
};

export function isValidImage(buffer, ext) {
  const signature = IMAGE_SIGNATURES[ext];
  return Boolean(signature) && buffer.subarray(0, signature.length).equals(Buffer.from(signature));
}
