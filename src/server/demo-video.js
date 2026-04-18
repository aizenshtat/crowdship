import { randomUUID } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const DEFAULT_STORAGE_DIR = '/var/lib/crowdship/demo-video';
const DEFAULT_MAX_BYTES = 1024 * 1024 * 700;
const DEFAULT_BASE_URL = 'https://crowdship.aizenshtat.eu';
const PUBLIC_ASSET_SUBPATH = '/demo-video/assets';
const METADATA_FILE_NAME = 'metadata.json';

const ALLOWED_VIDEO_TYPES = Object.freeze({
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
});

export class DemoVideoError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'DemoVideoError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function getStorageDir() {
  return process.env.DEMO_VIDEO_STORAGE_DIR || DEFAULT_STORAGE_DIR;
}

function getUploadToken() {
  return typeof process.env.DEMO_VIDEO_UPLOAD_TOKEN === 'string'
    ? process.env.DEMO_VIDEO_UPLOAD_TOKEN.trim()
    : '';
}

function getMaxBytes() {
  const parsed = Number.parseInt(process.env.DEMO_VIDEO_MAX_BYTES ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_BYTES;
}

function getBaseUrl() {
  const baseUrl = typeof process.env.CROWDSHIP_BASE_URL === 'string'
    ? process.env.CROWDSHIP_BASE_URL.trim()
    : '';
  return baseUrl || DEFAULT_BASE_URL;
}

function getPublicDir(storageDir = getStorageDir()) {
  return join(storageDir, 'public');
}

function getMetadataPath(storageDir = getStorageDir()) {
  return join(storageDir, METADATA_FILE_NAME);
}

function ensureStorageDirs(storageDir = getStorageDir()) {
  mkdirSync(storageDir, { recursive: true });
  mkdirSync(getPublicDir(storageDir), { recursive: true });
}

function readMetadataFile(storageDir = getStorageDir()) {
  const metadataPath = getMetadataPath(storageDir);

  if (!existsSync(metadataPath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(metadataPath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function buildVideoAssetPath(storedFilename) {
  return `${PUBLIC_ASSET_SUBPATH}/${storedFilename}`;
}

function buildDemoVideoStatusResponse(metadata = readMetadataFile()) {
  const uploadToken = getUploadToken();
  const baseUrl = getBaseUrl().replace(/\/$/, '');
  const hasVideo = Boolean(metadata?.storedFilename);
  const videoPath = hasVideo ? buildVideoAssetPath(metadata.storedFilename) : null;

  return {
    uploadEnabled: uploadToken.length > 0,
    hasVideo,
    maxBytes: getMaxBytes(),
    demoPageUrl: `${baseUrl}/demo-video/`,
    videoPath,
    videoUrl: videoPath ? `${baseUrl}${videoPath}` : null,
    video: hasVideo
      ? {
          filename: metadata.filename,
          contentType: metadata.contentType,
          sizeBytes: metadata.sizeBytes,
          uploadedAt: metadata.uploadedAt,
        }
      : null,
  };
}

function sanitizeFilename(filename, fallbackExtension) {
  const normalized = basename(typeof filename === 'string' ? filename : '').replace(/[^a-zA-Z0-9._-]+/g, '-');
  const safeName = normalized.replace(/^-+|-+$/g, '');

  if (!safeName) {
    return `demo-video${fallbackExtension}`;
  }

  return safeName;
}

function createSizeLimitTransform(maxBytes) {
  let sizeBytes = 0;

  const stream = new Transform({
    transform(chunk, encoding, callback) {
      sizeBytes += chunk.length;
      if (sizeBytes > maxBytes) {
        callback(new DemoVideoError(413, 'demo_video_too_large', `Video exceeds the ${maxBytes} byte limit.`));
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

function validateUploadHeaders(request) {
  const token = typeof request.headers['x-demo-video-token'] === 'string'
    ? request.headers['x-demo-video-token'].trim()
    : '';
  const expectedToken = getUploadToken();

  if (!expectedToken) {
    throw new DemoVideoError(503, 'demo_video_upload_disabled', 'Demo video upload is not configured on this server.');
  }

  if (!token || token !== expectedToken) {
    throw new DemoVideoError(403, 'demo_video_upload_forbidden', 'Upload token is invalid.');
  }

  const contentTypeHeader = Array.isArray(request.headers['content-type'])
    ? request.headers['content-type'][0]
    : request.headers['content-type'] ?? '';
  const contentType = String(contentTypeHeader).split(';')[0].trim().toLowerCase();
  const extension = ALLOWED_VIDEO_TYPES[contentType];

  if (!extension) {
    throw new DemoVideoError(415, 'demo_video_type_not_supported', 'Upload an MP4, WebM, or MOV video.');
  }

  const contentLengthHeader = Array.isArray(request.headers['content-length'])
    ? request.headers['content-length'][0]
    : request.headers['content-length'] ?? '';
  const contentLength = Number.parseInt(String(contentLengthHeader), 10);

  if (Number.isFinite(contentLength) && contentLength > getMaxBytes()) {
    throw new DemoVideoError(413, 'demo_video_too_large', `Video exceeds the ${getMaxBytes()} byte limit.`);
  }

  const rawFilenameHeader = Array.isArray(request.headers['x-demo-video-filename'])
    ? request.headers['x-demo-video-filename'][0]
    : request.headers['x-demo-video-filename'] ?? '';
  const filename = sanitizeFilename(String(rawFilenameHeader), extension);

  return {
    contentType,
    extension,
    filename,
  };
}

export function getDemoVideoStatus() {
  ensureStorageDirs();
  return buildDemoVideoStatusResponse();
}

export async function storeDemoVideoUpload(request) {
  const storageDir = getStorageDir();
  ensureStorageDirs(storageDir);

  const { contentType, extension, filename } = validateUploadHeaders(request);
  const maxBytes = getMaxBytes();
  const metadata = readMetadataFile(storageDir);
  const storedFilename = `current-${Date.now()}-${randomUUID()}${extension}`;
  const tempPath = join(storageDir, `upload-${randomUUID()}.tmp`);
  const finalPath = join(getPublicDir(storageDir), storedFilename);
  const sizeLimit = createSizeLimitTransform(maxBytes);

  try {
    await pipeline(request, sizeLimit.stream, createWriteStream(tempPath));
    const sizeBytes = sizeLimit.getSizeBytes();

    if (sizeBytes <= 0) {
      throw new DemoVideoError(400, 'demo_video_empty_upload', 'Choose a non-empty video file.');
    }

    renameSync(tempPath, finalPath);

    if (metadata?.storedFilename) {
      rmSync(join(getPublicDir(storageDir), metadata.storedFilename), { force: true });
    }

    const nextMetadata = {
      filename,
      storedFilename,
      contentType,
      sizeBytes,
      uploadedAt: new Date().toISOString(),
    };

    writeFileSync(getMetadataPath(storageDir), `${JSON.stringify(nextMetadata, null, 2)}\n`, 'utf8');
    return buildDemoVideoStatusResponse(nextMetadata);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}
