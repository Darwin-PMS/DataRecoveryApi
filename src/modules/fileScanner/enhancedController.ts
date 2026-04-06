import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import { promisify } from 'util';
import { createReadStream } from 'fs';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Magic byte signatures for file type detection
const MAGIC_SIGNATURES: Array<{
  type: string;
  extension: string;
  mime: string;
  signature: number[];
  offset: number;
}> = [
  // Images
  { type: 'JPEG', extension: '.jpg', mime: 'image/jpeg', signature: [0xFF, 0xD8, 0xFF], offset: 0 },
  { type: 'PNG', extension: '.png', mime: 'image/png', signature: [0x89, 0x50, 0x4E, 0x47], offset: 0 },
  { type: 'GIF', extension: '.gif', mime: 'image/gif', signature: [0x47, 0x49, 0x46, 0x38], offset: 0 },
  { type: 'BMP', extension: '.bmp', mime: 'image/bmp', signature: [0x42, 0x4D], offset: 0 },
  { type: 'TIFF', extension: '.tiff', mime: 'image/tiff', signature: [0x49, 0x49, 0x2A, 0x00], offset: 0 },
  { type: 'TIFF', extension: '.tiff', mime: 'image/tiff', signature: [0x4D, 0x4D, 0x00, 0x2A], offset: 0 },
  { type: 'WebP', extension: '.webp', mime: 'image/webp', signature: [0x52, 0x49, 0x46, 0x46], offset: 0 },
  
  // Documents
  { type: 'PDF', extension: '.pdf', mime: 'application/pdf', signature: [0x25, 0x50, 0x44, 0x46], offset: 0 },
  { type: 'Word', extension: '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', signature: [0x50, 0x4B, 0x03, 0x04], offset: 0 },
  { type: 'Excel', extension: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', signature: [0x50, 0x4B, 0x03, 0x04], offset: 0 },
  
  // Archives
  { type: 'ZIP', extension: '.zip', mime: 'application/zip', signature: [0x50, 0x4B, 0x03, 0x04], offset: 0 },
  { type: 'RAR', extension: '.rar', mime: 'application/vnd.rar', signature: [0x52, 0x61, 0x72, 0x21], offset: 0 },
  { type: '7Z', extension: '.7z', mime: 'application/x-7z-compressed', signature: [0x37, 0x7A, 0xBC, 0xAF], offset: 0 },
  { type: 'GZIP', extension: '.gz', mime: 'application/gzip', signature: [0x1F, 0x8B], offset: 0 },
  
  // Executables
  { type: 'PE', extension: '.exe', mime: 'application/x-dosexec', signature: [0x4D, 0x5A], offset: 0 },
  { type: 'ELF', extension: '.elf', mime: 'application/x-executable', signature: [0x7F, 0x45, 0x4C, 0x46], offset: 0 },
  
  // Disk Images
  { type: 'E01', extension: '.E01', mime: 'application/x-e01', signature: [0x45, 0x56, 0x46, 0x09], offset: 0 },
  { type: 'VMDK', extension: '.vmdk', mime: 'application/x-vmdk', signature: [0x4B, 0x44, 0x4D, 0x56], offset: 0 },
];

// Schema validators
const deepScanSchema = z.object({
  filePath: z.string().min(1, 'File path is required'),
  extractMetadata: z.boolean().default(true),
  calculateHashes: z.boolean().default(true),
  detectFileType: z.boolean().default(true),
  analyzeEntropy: z.boolean().default(true),
  extractStrings: z.boolean().default(false),
  checkSteganography: z.boolean().default(false),
});

const batchScanSchema = z.object({
  filePaths: z.array(z.string()).min(1, 'At least one file path required'),
  scanOptions: z.object({
    extractMetadata: z.boolean().default(true),
    calculateHashes: z.boolean().default(true),
    detectFileType: z.boolean().default(true),
    analyzeEntropy: z.boolean().default(true),
  }).default({}),
});

const uploadAndScanSchema = z.object({
  fileName: z.string().min(1, 'File name is required'),
  fileSize: z.number().max(1024 * 1024 * 1024, 'File size must be less than 1GB'),
  scanOptions: z.object({
    extractMetadata: z.boolean().default(true),
    calculateHashes: z.boolean().default(true),
    detectFileType: z.boolean().default(true),
  }).default({}),
});

// Helper: Calculate file hashes (MD5, SHA1, SHA256)
async function calculateFileHashes(filePath: string): Promise<{
  md5: string;
  sha1: string;
  sha256: string;
}> {
  const md5Hash = createHash('md5');
  const sha1Hash = createHash('sha1');
  const sha256Hash = createHash('sha256');

  return new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    
    stream.on('data', (data) => {
      md5Hash.update(data);
      sha1Hash.update(data);
      sha256Hash.update(data);
    });
    
    stream.on('end', () => {
      resolve({
        md5: md5Hash.digest('hex'),
        sha1: sha1Hash.digest('hex'),
        sha256: sha256Hash.digest('hex'),
      });
    });
    
    stream.on('error', reject);
  });
}

// Helper: Calculate Shannon entropy
function calculateEntropy(filePath: string): number {
  try {
    const buffer = fs.readFileSync(filePath);
    const frequency = new Array(256).fill(0);
    
    for (const byte of buffer) {
      frequency[byte]++;
    }
    
    let entropy = 0;
    const length = buffer.length;
    
    for (const freq of frequency) {
      if (freq > 0) {
        const probability = freq / length;
        entropy -= probability * Math.log2(probability);
      }
    }
    
    return entropy;
  } catch {
    return 0;
  }
}

// Helper: Detect file type using magic bytes
function detectFileTypeByMagic(filePath: string): {
  detected: boolean;
  type: string;
  extension: string;
  mime: string;
  confidence: number;
} {
  try {
    const buffer = fs.readFileSync(filePath);
    
    for (const sig of MAGIC_SIGNATURES) {
      let match = true;
      
      for (let i = 0; i < sig.signature.length; i++) {
        if (buffer[sig.offset + i] !== sig.signature[i]) {
          match = false;
          break;
        }
      }
      
      if (match) {
        return {
          detected: true,
          type: sig.type,
          extension: sig.extension,
          mime: sig.mime,
          confidence: 100,
        };
      }
    }
    
    return {
      detected: false,
      type: 'unknown',
      extension: path.extname(filePath),
      mime: 'application/octet-stream',
      confidence: 0,
    };
  } catch {
    return {
      detected: false,
      type: 'error',
      extension: '',
      mime: '',
      confidence: 0,
    };
  }
}

// Helper: Extract metadata from file
async function extractFileMetadata(filePath: string): Promise<any> {
  const stats = fs.statSync(filePath);
  const metadata: any = {
    fileName: path.basename(filePath),
    filePath: filePath,
    fileSize: stats.size,
    fileSizeFormatted: formatBytes(stats.size),
    createdAt: stats.birthtime,
    modifiedAt: stats.mtime,
    accessedAt: stats.atime,
    permissions: stats.mode.toString(8),
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    inode: stats.ino,
    device: stats.dev,
    hardLinks: stats.nlink,
    uid: stats.uid,
    gid: stats.gid,
  };

  // Try to extract EXIF data if available (requires exiftool)
  try {
    const { stdout } = await execAsync(`exiftool -json "${filePath}"`);
    const exifData = JSON.parse(stdout);
    if (exifData.length > 0) {
      metadata.exif = exifData[0];
    }
  } catch {
    metadata.exif = null;
  }

  return metadata;
}

// Helper: Extract strings from binary file
function extractStrings(filePath: string, minLength: number = 4): string[] {
  try {
    const buffer = fs.readFileSync(filePath);
    const strings: string[] = [];
    let currentString = '';
    
    for (let i = 0; i < buffer.length; i++) {
      const byte = buffer[i];
      
      // Printable ASCII characters
      if (byte >= 32 && byte <= 126) {
        currentString += String.fromCharCode(byte);
      } else {
        if (currentString.length >= minLength) {
          strings.push(currentString);
        }
        currentString = '';
      }
    }
    
    // Don't forget the last string
    if (currentString.length >= minLength) {
      strings.push(currentString);
    }
    
    return strings.slice(0, 10000); // Limit to first 10000 strings
  } catch {
    return [];
  }
}

// Helper: Format bytes to human-readable
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: Perform LSB steganalysis
function analyzeLSB(filePath: string): {
  suspicious: boolean;
  confidence: number;
  details: any;
} {
  try {
    const buffer = fs.readFileSync(filePath);
    
    // Check if it's an image file
    if (buffer[0] !== 0xFF && buffer[0] !== 0x89 && buffer[0] !== 0x47) {
      return {
        suspicious: false,
        confidence: 0,
        details: { message: 'Not an image file' },
      };
    }
    
    // Simplified LSB analysis - check bit distribution in pixel data
    let zeroCount = 0;
    let oneCount = 0;
    const sampleSize = Math.min(buffer.length, 100000);
    
    for (let i = 0; i < sampleSize; i++) {
      const lsb = buffer[i] & 1;
      if (lsb === 0) zeroCount++;
      else oneCount++;
    }
    
    const total = zeroCount + oneCount;
    const zeroRatio = zeroCount / total;
    const oneRatio = oneCount / total;
    
    // In normal images, LSB distribution should be roughly 50/50
    // Significant deviation suggests hidden data
    const deviation = Math.abs(zeroRatio - 0.5);
    const suspicious = deviation < 0.05; // Less than 5% deviation is suspicious
    
    return {
      suspicious,
      confidence: Math.round((1 - deviation * 10) * 100),
      details: {
        zeroBits: zeroCount,
        oneBits: oneCount,
        zeroRatio: zeroRatio.toFixed(4),
        oneRatio: oneRatio.toFixed(4),
        deviation: deviation.toFixed(4),
        sampleSize,
      },
    };
  } catch {
    return {
      suspicious: false,
      confidence: 0,
      details: { message: 'Analysis failed' },
    };
  }
}

// Handler: Deep file scan
export async function deepFileScan(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = deepScanSchema.parse(request.body);
    const { filePath, extractMetadata, calculateHashes: calcHashes, detectFileType: detectType, analyzeEntropy, extractStrings: extractStrs, checkSteganography } = body;
    
    // Verify file exists
    if (!fs.existsSync(filePath)) {
      return reply.status(400).send({
        code: 'FILE_NOT_FOUND',
        message: 'File does not exist'
      });
    }
    
    const scanResult: any = {
      filePath,
      scanTimestamp: new Date(),
      scanDuration: 0,
    };
    
    const startTime = Date.now();
    
    // Extract metadata
    if (extractMetadata) {
      scanResult.metadata = await extractFileMetadata(filePath);
    }
    
    // Calculate hashes
    if (calcHashes) {
      scanResult.hashes = await calculateFileHashes(filePath);
    }
    
    // Detect file type
    if (detectType) {
      scanResult.fileTypeDetection = detectFileTypeByMagic(filePath);
    }
    
    // Analyze entropy
    if (analyzeEntropy) {
      scanResult.entropy = calculateEntropy(filePath);
      
      // High entropy (>7.5) may indicate encryption or compression
      if (scanResult.entropy > 7.5) {
        scanResult.suspicious = true;
        scanResult.suspiciousReasons = scanResult.suspiciousReasons || [];
        scanResult.suspiciousReasons.push('High entropy suggests encryption/compression');
      }
    }
    
    // Extract strings
    if (extractStrs) {
      scanResult.strings = extractStrings(filePath);
      scanResult.stringsCount = scanResult.strings.length;
    }
    
    // Check steganography
    if (checkSteganography) {
      scanResult.steganalysis = {
        lsb: analyzeLSB(filePath),
      };
    }
    
    scanResult.scanDuration = Date.now() - startTime;
    
    // Calculate threat level
    scanResult.threatLevel = 'LOW';
    if (scanResult.suspicious) {
      scanResult.threatLevel = 'MEDIUM';
    }
    if (scanResult.steganalysis?.lsb?.suspicious) {
      scanResult.threatLevel = 'HIGH';
    }
    
    return reply.send({
      code: 'SCAN_COMPLETE',
      data: scanResult
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'SCAN_FAILED',
      message: 'Failed to scan file',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Batch file scan
export async function batchFileScan(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = batchScanSchema.parse(request.body);
    const { filePaths, scanOptions } = body;
    
    const results: Array<{
      filePath: string;
      status: string;
      error?: string;
      result?: any;
    }> = [];
    
    for (const filePath of filePaths) {
      try {
        if (!fs.existsSync(filePath)) {
          results.push({
            filePath,
            status: 'error',
            error: 'File not found'
          });
          continue;
        }
        
        const scanResult: any = {
          filePath,
          scanTimestamp: new Date(),
        };
        
        if (scanOptions.extractMetadata !== false) {
          scanResult.metadata = await extractFileMetadata(filePath);
        }
        
        if (scanOptions.calculateHashes !== false) {
          scanResult.hashes = await calculateFileHashes(filePath);
        }
        
        if (scanOptions.detectFileType !== false) {
          scanResult.fileTypeDetection = detectFileTypeByMagic(filePath);
        }
        
        if (scanOptions.analyzeEntropy !== false) {
          scanResult.entropy = calculateEntropy(filePath);
        }
        
        results.push({
          filePath,
          status: 'success',
          result: scanResult
        });
      } catch (error) {
        results.push({
          filePath,
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length;
    const errorCount = results.filter(r => r.status === 'error').length;
    
    return reply.send({
      code: 'BATCH_SCAN_COMPLETE',
      data: {
        totalFiles: filePaths.length,
        successCount,
        errorCount,
        results
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'BATCH_SCAN_FAILED',
      message: 'Failed to perform batch scan',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Get file signatures database
export async function getFileSignatures(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    return reply.send({
      code: 'SIGNATURES_RETRIEVED',
      data: {
        totalSignatures: MAGIC_SIGNATURES.length,
        signatures: MAGIC_SIGNATURES.map(sig => ({
          type: sig.type,
          extension: sig.extension,
          mime: sig.mime,
          signature: '0x' + sig.signature.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(' '),
          offset: sig.offset,
        }))
      }
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'SIGNATURES_RETRIEVAL_FAILED',
      message: 'Failed to retrieve signatures',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Register routes
export async function enhancedScannerRoutes(fastify: FastifyInstance) {
  fastify.post('/deep-scan', deepFileScan);
  fastify.post('/batch-scan', batchFileScan);
  fastify.get('/signatures', getFileSignatures);
}
