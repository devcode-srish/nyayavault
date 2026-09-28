/**
 * Builds a safe Content-Disposition header. File names come from users, so
 * anything that isn't printable ASCII is replaced in the plain form and sent
 * properly encoded in the RFC 5987 form.
 */
export function attachmentHeader(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
