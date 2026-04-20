import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync, renameSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_STORAGE_DIR = '/var/lib/crowdship/attachments';
const DEFAULT_MAX_BYTES = 1024 * 1024 * 25;
const METADATA_ONLY_PREFIX = 'metadata-only://';

const ALLOWED_ATTACHMENT_TYPES = Object.freeze({
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'text/csv': '.csv',
  'text/plain': '.txt',
});

export class AttachmentUploadError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'AttachmentUploadError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createMetadataOnlyAttachmentStorageKey(contributionId, filename) {
  return `${METADATA_ONLY_PREFIX}${contributionId}/${encodeURIComponent(filename)}`;
}

export function isMetadataOnlyAttachmentStorageKey(storageKey) {
  return typeof storageKey === 'string' && storageKey.startsWith(METADATA_ONLY_PREFIX);
}

function getStorageDir() {
  return process.env.ATTACHMENT_STORAGE_DIR || DEFAULT_STORAGE_DIR;
}

function getMaxBytes() {
  const parsed = Number.parseInt(process.env.ATTACHMENT_MAX_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : '';
  }

  return typeof value === 'string' ? value.trim() : '';
}

function sanitizePathSegment(value, fallback) {
  const normalized = basename(typeof value === 'string' ? value : '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const safeValue = normalized.replace(/^-+|-+$/g, '');
  return safeValue || fallback;
}

function resolveExtension(filename, contentType) {
  const allowedExtension = ALLOWED_ATTACHMENT_TYPES[contentType];

  if (!allowedExtension) {
    return null;
  }

  const filenameExtension = extname(typeof filename === 'string' ? filename : '').toLowerCase();
  return filenameExtension || allowedExtension;
}

function createSizeLimitTransform(maxBytes) {
  let sizeBytes = 0;

  const stream = new Transform({
    transform(chunk, encoding, callback) {
      sizeBytes += chunk.length;

      if (sizeBytes > maxBytes) {
        callback(
          new AttachmentUploadError(
            413,
            'attachment_too_large',
            `Attachment exceeds the ${maxBytes} byte limit.`,
          ),
        );
        return;
      }

      callback(null, chunk);
    },
  });

  return {
    stream,
    getSizeBytes: () => sizeBytes,
  };
}

function ensureStorageDirs(storageDir, contributionId, attachmentId) {
  mkdirSync(storageDir, { recursive: true });
  mkdirSync(join(storageDir, contributionId), { recursive: true });
  mkdirSync(join(storageDir, contributionId, attachmentId), { recursive: true });
}

function resolveUploadContentType(request, attachment) {
  const headerContentType = normalizeHeaderValue(request.headers['content-type']).split(';')[0].trim().toLowerCase();
  const attachmentContentType = typeof attachment?.contentType === 'string'
    ? attachment.contentType.trim().toLowerCase()
    : '';
  const contentType = headerContentType || attachmentContentType;

  if (!contentType || !ALLOWED_ATTACHMENT_TYPES[contentType]) {
    throw new AttachmentUploadError(
      415,
      'attachment_type_not_supported',
      'Upload a PNG, JPEG, WebP, plain text, CSV, or PDF attachment.',
    );
  }

  if (attachmentContentType && headerContentType && headerContentType !== attachmentContentType) {
    throw new AttachmentUploadError(
      415,
      'attachment_content_type_mismatch',
      'Upload content type must match the stored attachment metadata.',
    );
  }

  return contentType;
}

function resolveContentLength(request, maxBytes) {
  const rawContentLength = normalizeHeaderValue(request.headers['content-length']);
  const contentLength = Number.parseInt(rawContentLength, 10);

  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new AttachmentUploadError(
      413,
      'attachment_too_large',
      `Attachment exceeds the ${maxBytes} byte limit.`,
    );
  }
}

export async function storeContributionAttachmentUpload(request, { contributionId, attachment }) {
  const storageDir = getStorageDir();
  const safeContributionId = sanitizePathSegment(contributionId, 'contribution');
  const safeAttachmentId = sanitizePathSegment(attachment?.id, 'attachment');
  const contentType = resolveUploadContentType(request, attachment);
  const extension = resolveExtension(attachment?.filename, contentType);
  const maxBytes = getMaxBytes();

  if (!extension) {
    throw new AttachmentUploadError(
      415,
      'attachment_type_not_supported',
      'Upload a PNG, JPEG, WebP, plain text, CSV, or PDF attachment.',
    );
  }

  resolveContentLength(request, maxBytes);
  ensureStorageDirs(storageDir, safeContributionId, safeAttachmentId);

  const storedFilename = `${Date.now()}-${randomUUID()}${extension}`;
  const tempPath = join(storageDir, safeContributionId, safeAttachmentId, `upload-${randomUUID()}.tmp`);
  const finalPath = join(storageDir, safeContributionId, safeAttachmentId, storedFilename);
  const storageKey = join(safeContributionId, safeAttachmentId, storedFilename).replaceAll('\\', '/');
  const sizeLimit = createSizeLimitTransform(maxBytes);

  try {
    await pipeline(request, sizeLimit.stream, createWriteStream(tempPath));
    const sizeBytes = sizeLimit.getSizeBytes();

    if (sizeBytes <= 0) {
      throw new AttachmentUploadError(400, 'attachment_empty_upload', 'Choose a non-empty attachment.');
    }

    renameSync(tempPath, finalPath);

    return {
      storageKey,
      sizeBytes,
    };
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

export function deleteStoredAttachment(storageKey) {
  if (typeof storageKey !== 'string' || !storageKey.trim()) {
    return;
  }

  rmSync(join(getStorageDir(), storageKey), { force: true });
}
