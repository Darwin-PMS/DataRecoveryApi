import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

// Schema validators
const deepDriveScanSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  parseUSN: z.boolean().default(true),
  scanDeleted: z.boolean().default(true),
  extractTimelines: z.boolean().default(true),
  maxDepth: z.number().min(1).max(50).default(20),
});

const usnJournalSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  filterTypes: z.array(z.enum(['CREATE', 'DELETE', 'MODIFY', 'RENAME'])).default(['CREATE', 'DELETE', 'MODIFY', 'RENAME']),
});

const deletedFileScanSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  scanMFT: z.boolean().default(true),
  scanRecycleBin: z.boolean().default(true),
  scanTempFiles: z.boolean().default(true),
  fileTypes: z.array(z.string()).optional(),
});

const timelineReconstructionSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  sources: z.array(z.enum(['FILESYSTEM', 'REGISTRY', 'EVENTLOG', 'USB', 'BROWSER'])).default(['FILESYSTEM']),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  groupBy: z.enum(['hour', 'day', 'week', 'month']).default('day'),
});

// Helper: Get detailed drive information
async function getDetailedDrives(): Promise<any[]> {
  const drives: any[] = [];

  if (process.platform === 'win32') {
    try {
      // Get logical disks
      const { stdout: diskInfo } = await execAsync(
        'wmic logicaldisk get caption,drivetype,filesystem,size,freespace,volumename,description /format:csv'
      );
      
      const lines = diskInfo.trim().split('\n').slice(1);
      
      for (const line of lines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 7) {
          const driveLetter = parts[1];
          const driveType = parseInt(parts[2]);
          const fileSystem = parts[3];
          const size = parts[4] ? parseInt(parts[4]) : 0;
          const freeSpace = parts[5] ? parseInt(parts[5]) : 0;
          const volumeName = parts[6];
          const description = parts[7];

          const typeNames = ['Unknown', 'No Root Dir', 'Removable', 'Local Disk', 'Network Drive', 'CD-ROM', 'RAM Disk'];
          
          drives.push({
            id: driveLetter,
            path: driveLetter,
            name: volumeName || description || typeNames[driveType] || 'Unknown',
            type: typeNames[driveType] || 'unknown',
            driveType,
            fileSystem: fileSystem || 'unknown',
            size: size || 0,
            freeSpace: freeSpace || 0,
            usedSpace: size ? size - freeSpace : 0,
            usagePercent: size ? Math.round(((size - freeSpace) / size) * 100) : 0,
            isReady: driveType !== 1,
          });
        }
      }

      // Get disk model info from physical disks
      const { stdout: physicalInfo } = await execAsync(
        'wmic diskdrive get model,size,interfacetype,mediatype /format:csv'
      );
      
      // Merge physical info with logical drives
      const physicalLines = physicalInfo.trim().split('\n').slice(1);
      for (const line of physicalLines) {
        const parts = line.split(',').map(p => p.trim());
        if (parts.length >= 4) {
          const model = parts[1];
          const size = parts[2] ? parseInt(parts[2]) : 0;
          const interfaceType = parts[3];
          const mediaType = parts[4];

          // Try to match with logical drives
          for (const drive of drives) {
            if (Math.abs(drive.size - size) < size * 0.1) { // Within 10% tolerance
              drive.model = model;
              drive.interfaceType = interfaceType;
              drive.mediaType = mediaType;
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error('Error getting detailed drives:', error);
    }
  } else {
    // Linux/macOS fallback
    try {
      const { stdout } = await execAsync('df -hT');
      const lines = stdout.trim().split('\n').slice(1);
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 7 && parts[6] !== '/') {
          drives.push({
            id: parts[6],
            path: parts[6],
            name: path.basename(parts[6]) || 'Root',
            type: parts[1] || 'unknown',
            fileSystem: parts[1] || 'unknown',
            size: parts[2] ? parseSizeString(parts[2]) : 0,
            usedSpace: parts[3] ? parseSizeString(parts[3]) : 0,
            freeSpace: parts[4] ? parseSizeString(parts[4]) : 0,
            usagePercent: parts[5] ? parseInt(parts[5].replace('%', '')) : 0,
            isReady: true,
          });
        }
      }
    } catch (error) {
      console.error('Error getting detailed drives:', error);
    }
  }

  return drives;
}

// Helper: Parse size string (e.g., "100G", "500M")
function parseSizeString(sizeStr: string): number {
  const match = sizeStr.match(/^(\d+)([KMGTP]?)$/);
  if (!match) return 0;
  
  const value = parseInt(match[1]);
  const unit = match[2];
  const multipliers: { [key: string]: number } = {
    '': 1,
    'K': 1024,
    'M': 1024 * 1024,
    'G': 1024 * 1024 * 1024,
    'T': 1024 * 1024 * 1024 * 1024,
    'P': 1024 * 1024 * 1024 * 1024 * 1024,
  };
  
  return value * (multipliers[unit] || 1);
}

// Helper: Parse USN Journal (Windows NTFS)
async function parseUSNJournal(drivePath: string, options: {
  startDate?: string;
  endDate?: string;
  filterTypes?: string[];
}): Promise<any> {
  const usnRecords: Array<{
    timestamp: Date;
    eventType: string;
    fileName: string;
    filePath: string;
    size: number;
    isDirectory: boolean;
    usn: number;
    fileReferenceNumber: number;
    parentFileReferenceNumber: number;
  }> = [];

  if (process.platform !== 'win32') {
    return {
      supported: false,
      message: 'USN Journal parsing is only supported on Windows',
      records: [],
    };
  }

  try {
    // Use fsutil to query USN journal
    const driveLetter = drivePath.charAt(0);
    const { stdout } = await execAsync(
      `fsutil usn readjournal ${driveLetter}: maxwait=1000`
    );

    const lines = stdout.split('\n');
    let currentRecord: any = {};

    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('USN Reason:')) {
        if (currentRecord.reason) {
          // Save previous record
          if (currentRecord.fileName && currentRecord.timestamp) {
            const eventType = getEventTypeFromReason(currentRecord.reason);
            
            if (!options.filterTypes || options.filterTypes.includes(eventType)) {
              const recordDate = new Date(currentRecord.timestamp);
              
              if ((!options.startDate || recordDate >= new Date(options.startDate)) &&
                  (!options.endDate || recordDate <= new Date(options.endDate))) {
                usnRecords.push({
                  timestamp: recordDate,
                  eventType,
                  fileName: currentRecord.fileName,
                  filePath: currentRecord.filePath || '',
                  size: currentRecord.size || 0,
                  isDirectory: currentRecord.isDirectory || false,
                  usn: currentRecord.usn || 0,
                  fileReferenceNumber: currentRecord.fileReferenceNumber || 0,
                  parentFileReferenceNumber: currentRecord.parentFileReferenceNumber || 0,
                });
              }
            }
          }
        }
        
        currentRecord = { reason: trimmed.replace('USN Reason:', '').trim() };
      } else if (trimmed.startsWith('File Name:')) {
        currentRecord.fileName = trimmed.replace('File Name:', '').trim();
      } else if (trimmed.startsWith('Timestamp:')) {
        currentRecord.timestamp = trimmed.replace('Timestamp:', '').trim();
      } else if (trimmed.startsWith('Size:')) {
        currentRecord.size = parseInt(trimmed.replace('Size:', '').trim()) || 0;
      } else if (trimmed.startsWith('USN:')) {
        currentRecord.usn = parseInt(trimmed.replace('USN:', '').trim(), 16) || 0;
      }
    }

    return {
      supported: true,
      totalRecords: usnRecords.length,
      records: usnRecords.slice(0, 10000), // Limit to first 10000
      dateRange: {
        from: usnRecords.length > 0 ? usnRecords[0].timestamp : null,
        to: usnRecords.length > 0 ? usnRecords[usnRecords.length - 1].timestamp : null,
      },
      eventTypes: {
        CREATE: usnRecords.filter(r => r.eventType === 'CREATE').length,
        DELETE: usnRecords.filter(r => r.eventType === 'DELETE').length,
        MODIFY: usnRecords.filter(r => r.eventType === 'MODIFY').length,
        RENAME: usnRecords.filter(r => r.eventType === 'RENAME').length,
      },
    };
  } catch (error) {
    return {
      supported: true,
      error: error instanceof Error ? error.message : 'Failed to parse USN journal',
      records: [],
      totalRecords: 0,
    };
  }
}

// Helper: Get event type from USN reason
function getEventTypeFromReason(reason: string): string {
  const reasonUpper = reason.toUpperCase();
  
  if (reasonUpper.includes('CREATE')) return 'CREATE';
  if (reasonUpper.includes('DELETE')) return 'DELETE';
  if (reasonUpper.includes('RENAME')) return 'RENAME';
  if (reasonUpper.includes('MODIFY') || reasonUpper.includes('WRITE')) return 'MODIFY';
  
  return 'MODIFY'; // Default
}

// Helper: Scan for deleted files
async function scanDeletedFiles(drivePath: string, options: {
  scanMFT?: boolean;
  scanRecycleBin?: boolean;
  scanTempFiles?: boolean;
  fileTypes?: string[];
}): Promise<any> {
  const deletedFiles: Array<{
    fileName: string;
    originalPath: string;
    deletedDate: Date;
    size: number;
    fileType: string;
    recoverable: boolean;
    confidence: number;
    location: string;
  }> = [];

  // Scan Recycle Bin
  if (options.scanRecycleBin !== false) {
    try {
      let recycleBinPath = '';
      
      if (process.platform === 'win32') {
        const driveLetter = drivePath.charAt(0);
        recycleBinPath = `${driveLetter}:\\$Recycle.Bin`;
        
        if (fs.existsSync(recycleBinPath)) {
          const sids = fs.readdirSync(recycleBinPath);
          
          for (const sid of sids) {
            const userRecyclePath = path.join(recycleBinPath, sid);
            
            try {
              const files = fs.readdirSync(userRecyclePath);
              
              for (const file of files) {
                if (file.startsWith('$I')) {
                  // $I files contain metadata
                  const metadataPath = path.join(userRecyclePath, file);
                  const correspondingRFile = file.replace('$I', '$R');
                  const rFilePath = path.join(userRecyclePath, correspondingRFile);
                  
                  try {
                    const stats = fs.statSync(metadataPath);
                    const rStats = fs.existsSync(rFilePath) ? fs.statSync(rFilePath) : null;
                    
                    // Parse $I file to get original filename and path
                    const buffer = fs.readFileSync(metadataPath);
                    const originalPath = parseRecycleBinIFile(buffer);
                    
                    deletedFiles.push({
                      fileName: originalPath ? path.basename(originalPath) : file,
                      originalPath: originalPath || 'Unknown',
                      deletedDate: stats.mtime,
                      size: rStats ? rStats.size : stats.size,
                      fileType: getFileExtension(originalPath || file),
                      recoverable: rStats !== null,
                      confidence: rStats ? 95 : 50,
                      location: 'Recycle Bin',
                    });
                  } catch (error) {
                    // Skip files that can't be read
                  }
                }
              }
            } catch (error) {
              // Skip inaccessible directories
            }
          }
        }
      }
    } catch (error) {
      console.error('Error scanning recycle bin:', error);
    }
  }

  // Scan Temp Files
  if (options.scanTempFiles !== false) {
    try {
      const tempPaths = process.platform === 'win32' 
        ? [process.env.TEMP || 'C:\\Windows\\Temp', 'C:\\Windows\\Temp']
        : ['/tmp', '/var/tmp'];

      for (const tempPath of tempPaths) {
        if (fs.existsSync(tempPath)) {
          const files = scanDirectoryForDeleted(tempPath, 2);
          deletedFiles.push(...files);
        }
      }
    } catch (error) {
      console.error('Error scanning temp files:', error);
    }
  }

  return {
    totalFound: deletedFiles.length,
    files: deletedFiles.slice(0, 5000),
    byLocation: {
      'Recycle Bin': deletedFiles.filter(f => f.location === 'Recycle Bin').length,
      'Temp Files': deletedFiles.filter(f => f.location === 'Temp Files').length,
      'MFT Entries': deletedFiles.filter(f => f.location === 'MFT').length,
    },
    byType: groupByFileType(deletedFiles),
    recoverableCount: deletedFiles.filter(f => f.recoverable).length,
  };
}

// Helper: Parse Recycle Bin $I file
function parseRecycleBinIFile(buffer: Buffer): string | null {
  try {
    // $I file format: 
    // Bytes 0-7: Unknown
    // Bytes 8-15: File size
    // Bytes 16-23: Deletion time (FILETIME)
    // Bytes 24+: Original path (UTF-16LE)
    
    if (buffer.length < 26) return null;
    
    const pathBuffer = buffer.slice(24);
    const nullIndex = pathBuffer.indexOf(0x0000, 0, 'utf16le');
    
    if (nullIndex > 0) {
      return pathBuffer.slice(0, nullIndex).toString('utf16le');
    }
    
    return pathBuffer.toString('utf16le').replace(/\0/g, '');
  } catch {
    return null;
  }
}

// Helper: Scan directory for files
function scanDirectoryForDeleted(dirPath: string, maxDepth: number): any[] {
  const files: any[] = [];
  
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      if (maxDepth <= 0) break;
      
      const fullPath = path.join(dirPath, entry.name);
      
      try {
        if (entry.isFile()) {
          const stats = fs.statSync(fullPath);
          
          files.push({
            fileName: entry.name,
            originalPath: fullPath,
            deletedDate: stats.mtime,
            size: stats.size,
            fileType: getFileExtension(entry.name),
            recoverable: true,
            confidence: 70,
            location: 'Temp Files',
          });
        } else if (entry.isDirectory()) {
          files.push(...scanDirectoryForDeleted(fullPath, maxDepth - 1));
        }
      } catch {
        // Skip inaccessible files
      }
    }
  } catch {
    // Skip inaccessible directories
  }
  
  return files;
}

// Helper: Get file extension/type
function getFileExtension(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  const types: { [key: string]: string } = {
    '.jpg': 'image', '.jpeg': 'image', '.png': 'image', '.gif': 'image',
    '.pdf': 'document', '.doc': 'document', '.docx': 'document',
    '.xls': 'spreadsheet', '.xlsx': 'spreadsheet',
    '.txt': 'text', '.log': 'text',
    '.exe': 'executable', '.dll': 'executable',
    '.zip': 'archive', '.rar': 'archive', '.7z': 'archive',
  };
  
  return types[ext] || 'other';
}

// Helper: Group files by file type
function groupByFileType(files: any[]): { [key: string]: number } {
  const groups: { [key: string]: number } = {};
  
  for (const file of files) {
    const type = file.fileType || 'other';
    groups[type] = (groups[type] || 0) + 1;
  }
  
  return groups;
}

// Helper: Reconstruct timeline from filesystem
async function reconstructTimeline(options: {
  caseId: string;
  sources: string[];
  dateFrom?: string;
  dateTo?: string;
  groupBy: string;
}): Promise<any> {
  const timeline: Array<{
    timestamp: Date;
    eventType: string;
    source: string;
    description: string;
    filePath?: string;
    metadata?: any;
  }> = [];

  // In production, would parse:
  // - NTFS USN Journal
  // - MFT entries
  // - Registry hives
  // - Event logs
  // - Browser history
  // For now, return framework
  
  return {
    caseId: options.caseId,
    totalEvents: timeline.length,
    dateRange: {
      from: options.dateFrom || 'Beginning',
      to: options.dateTo || 'Now',
    },
    groupBy: options.groupBy,
    sources: options.sources,
    events: timeline,
    statistics: {
      byEventType: {},
      bySource: {},
      byDay: {},
    },
  };
}

// Handler: Get detailed drives
export async function getDetailedDrivesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const drives = await getDetailedDrives();
    
    return reply.send({
      code: 'DRIVES_RETRIEVED',
      data: {
        totalDrives: drives.length,
        readyDrives: drives.filter(d => d.isReady).length,
        drives,
      }
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'DRIVES_RETRIEVAL_FAILED',
      message: 'Failed to retrieve drives',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Deep drive scan with USN
export async function deepDriveScanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = deepDriveScanSchema.parse(request.body);
    const { drivePath, parseUSN, scanDeleted, extractTimelines, maxDepth } = body;
    
    if (!fs.existsSync(drivePath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Drive path does not exist'
      });
    }
    
    const scanResult: any = {
      drivePath,
      scanTimestamp: new Date(),
      scanDuration: 0,
    };
    
    const startTime = Date.now();
    
    // Parse USN Journal
    if (parseUSN && process.platform === 'win32') {
      scanResult.usnJournal = await parseUSNJournal(drivePath, {});
    }
    
    // Scan deleted files
    if (scanDeleted) {
      scanResult.deletedFiles = await scanDeletedFiles(drivePath, {});
    }
    
    // Extract timeline
    if (extractTimelines) {
      scanResult.timeline = await reconstructTimeline({
        caseId: 'temp',
        sources: ['FILESYSTEM'],
        groupBy: 'day',
      });
    }
    
    scanResult.scanDuration = Date.now() - startTime;
    
    return reply.send({
      code: 'DEEP_SCAN_COMPLETE',
      data: scanResult
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'DEEP_SCAN_FAILED',
      message: 'Deep scan failed',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: USN Journal analysis
export async function usnJournalHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = usnJournalSchema.parse(request.body);
    const { drivePath, startDate, endDate, filterTypes } = body;
    
    const result = await parseUSNJournal(drivePath, {
      startDate,
      endDate,
      filterTypes,
    });
    
    return reply.send({
      code: 'USN_JOURNAL_PARSED',
      data: result
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'USN_JOURNAL_FAILED',
      message: 'Failed to parse USN journal',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Deleted file scan
export async function deletedFileScanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = deletedFileScanSchema.parse(request.body);
    const { drivePath, scanMFT, scanRecycleBin, scanTempFiles, fileTypes } = body;
    
    const result = await scanDeletedFiles(drivePath, {
      scanMFT,
      scanRecycleBin,
      scanTempFiles,
      fileTypes,
    });
    
    return reply.send({
      code: 'DELETED_FILES_FOUND',
      data: result
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'DELETED_FILE_SCAN_FAILED',
      message: 'Failed to scan for deleted files',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Timeline reconstruction
export async function timelineReconstructionHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = timelineReconstructionSchema.parse(request.body);
    const { caseId, sources, dateFrom, dateTo, groupBy } = body;
    
    const timeline = await reconstructTimeline({
      caseId,
      sources,
      dateFrom,
      dateTo,
      groupBy,
    });
    
    return reply.send({
      code: 'TIMELINE_RECONSTRUCTED',
      data: timeline
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'TIMELINE_RECONSTRUCTION_FAILED',
      message: 'Failed to reconstruct timeline',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Register routes
export async function enhancedForensicRoutes(fastify: FastifyInstance) {
  fastify.get('/detailed-drives', getDetailedDrivesHandler);
  fastify.post('/deep-drive-scan', deepDriveScanHandler);
  fastify.post('/usn-journal', usnJournalHandler);
  fastify.post('/deleted-files', deletedFileScanHandler);
  fastify.post('/timeline', timelineReconstructionHandler);
}
