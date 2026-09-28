import multer from "multer";
import { Request, Response, NextFunction } from "express";

// PDF + images + Word docs, per project decision for Phase 2.
export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error("Unsupported file type. Allowed: PDF, JPG, PNG, DOC, DOCX."));
    }
    cb(null, true);
  },
});

/**
 * Wraps multer's single-file middleware so upload errors (bad type,
 * too large) come back as a clean 400 JSON response instead of falling
 * through to the generic 500 handler.
 */
export function handleSingleFileUpload(req: Request, res: Response, next: NextFunction) {
  upload.single("file")(req, res, (err: unknown) => {
    if (err instanceof Error) {
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}
