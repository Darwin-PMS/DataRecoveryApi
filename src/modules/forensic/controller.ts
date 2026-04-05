import { FastifyRequest, FastifyReply } from 'fastify';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const prisma = new PrismaClient();

const scanPathSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  deepScan: z.boolean().default(false),
  recursive: z.boolean().default(true),
  maxDepth: z.number().min(1).max(20).default(10),
  fileTypes: z.array(z.string()).optional(),
  dateFilter: z.enum(['all', 'last7days', 'last30days', 'last90days', 'custom']).default('all'),
  customDateFrom: z.string().optional(),
  customDateTo: z.string().optional(),
  deletedOnly: z.boolean().default(false),
  hiddenOnly: z.boolean().default(false),
  minSize: z.number().optional(),
  maxSize: z.number().optional(),
});

const analyzePathSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  analyzeDeleted: z.boolean().default(true),
  analyzeHidden: z.boolean().default(true),
});

const recoverFilesSchema = z.object({
  filePaths: z.array(z.string()).min(1),
  destination: z.string().min(1),
  mode: z.enum(['copy', 'move']).default('copy'),
});

const deepScanSchema = z.object({
  path: z.string().min(1, 'Path is required'),
  options: z.object({
    deepScan: z.boolean().default(true),
    recursive: z.boolean().default(true),
    maxDepth: z.number().min(1).max(50).default(20),
    scanDeleted: z.boolean().default(true),
    scanHidden: z.boolean().default(true),
    scanTemp: z.boolean().default(true),
    dateFilter: z.enum(['all', 'last7days', 'last30days', 'last90days', 'custom']).default('all'),
    customDateFrom: z.string().optional(),
    customDateTo: z.string().optional(),
    fileTypes: z.array(z.string()).optional(),
    minSize: z.number().optional(),
    maxSize: z.number().optional(),
  }).optional(),
});

function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'bigint') return obj.toString();
  if (Array.isArray(obj)) return obj.map(item => serializeBigInt(item));
  if (typeof obj === 'object') {
    const result: any = {};
    for (const key of Object.keys(obj)) {
      result[key] = serializeBigInt(obj[key]);
    }
    return result;
  }
  return obj;
}

function getDateRange(filter: string, customFrom?: string, customTo?: string): { from?: Date; to?: Date } {
  const now = new Date();
  const to = now;
  let from: Date;
  
  switch (filter) {
    case 'last7days':
      from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'last30days':
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'last90days':
      from = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      break;
    case 'custom':
      from = customFrom ? new Date(customFrom) : new Date(0);
      return { from, to: customTo ? new Date(customTo) : now };
    default:
      from = new Date(0);
  }
  
  return { from, to };
}

function isDeleted(filePath: string): boolean {
  return !fs.existsSync(filePath);
}

function checkFilePermissions(filePath: string): { readable: boolean; writable: boolean; executable: boolean } {
  try {
    const stats = fs.statSync(filePath);
    return {
      readable: (stats.mode & parseInt('400', 8)) !== 0,
      writable: (stats.mode & parseInt('200', 8)) !== 0,
      executable: (stats.mode & parseInt('100', 8)) !== 0,
    };
  } catch {
    return { readable: false, writable: false, executable: false };
  }
}

function getFileType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const imageExts = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.svg', '.webp', '.tiff', '.raw', '.cr2', '.nef', '.arw'];
  const videoExts = ['.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv', '.webm', '.m4v', '.mpeg', '.mpg'];
  const audioExts = ['.mp3', '.wav', '.flac', '.aac', '.ogg', '.wma', '.m4a', '.opus'];
  const docExts = ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.txt', '.rtf', '.odt', '.ods'];
  const archiveExts = ['.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso'];
  const codeExts = ['.js', '.ts', '.py', '.java', '.cpp', '.c', '.h', '.cs', '.php', '.rb', '.go', '.rs'];
  
  if (imageExts.includes(ext)) return 'image';
  if (videoExts.includes(ext)) return 'video';
  if (audioExts.includes(ext)) return 'audio';
  if (docExts.includes(ext)) return 'document';
  if (archiveExts.includes(ext)) return 'archive';
  if (codeExts.includes(ext)) return 'code';
  return 'other';
}

async function scanDirectory(dirPath: string, options: {
  recursive: boolean;
  maxDepth: number;
  currentDepth: number;
  fileTypes?: string[];
}): Promise<any[]> {
  const results: any[] = [];
  
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      try {
        const stats = await fs.promises.stat(fullPath);
        
        const fileInfo: any = {
          name: entry.name,
          path: fullPath,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          accessed: stats.atime,
          isHidden: entry.name.startsWith('.'),
          isReadonly: !(stats.mode & parseInt('200', 8)),
          permissions: stats.mode.toString(8),
        };
        
        if (entry.isDirectory()) {
          fileInfo.isDirectory = true;
          fileInfo.fileType = 'folder';
          
          if (options.recursive && options.currentDepth < options.maxDepth) {
            const subResults = await scanDirectory(fullPath, {
              ...options,
              currentDepth: options.currentDepth + 1,
            });
            fileInfo.children = subResults.slice(0, 100);
            fileInfo.childrenCount = subResults.length;
          }
        } else {
          fileInfo.isDirectory = false;
          fileInfo.extension = path.extname(entry.name).toLowerCase();
          fileInfo.fileType = getFileType(entry.name);
          
          if (options.fileTypes && options.fileTypes.length > 0) {
            if (!options.fileTypes.includes(fileInfo.fileType)) {
              continue;
            }
          }
        }
        
        results.push(fileInfo);
      } catch (err) {
        console.error(`Error accessing ${fullPath}:`, err);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }
  
  return results;
}

async function getSystemDrives(): Promise<any[]> {
  const drives: any[] = [];
  
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync('wmic logicaldisk get caption,size,freespace,volumename,drivetype');
      const lines = stdout.trim().split('\n').slice(1);
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 4 && parts[0]) {
          const driveLetter = parts[0].replace(':', '');
          const driveType = parseInt(parts[1]) || 0;
          const size = parseInt(parts[2]) || 0;
          const freeSpace = parseInt(parts[3]) || 0;
          
          if (size > 0) {
            drives.push({
              id: `${driveLetter}:`,
              path: `${driveLetter}:\\`,
              name: parts[4] || `Local Disk (${driveLetter}:)`,
              type: driveType === 2 ? 'removable' : driveType === 3 ? 'local' : driveType === 4 ? 'network' : 'unknown',
              size: size,
              freeSpace: freeSpace,
              usedSpace: size - freeSpace,
            });
          }
        }
      }
    } catch (err) {
      console.error('Error getting drives:', err);
      drives.push({ id: 'C:', path: 'C:\\', name: 'C: Drive', type: 'local', size: 0, freeSpace: 0 });
    }
  } else if (process.platform === 'linux' || process.platform === 'darwin') {
    try {
      const { stdout } = await execAsync('df -k');
      const lines = stdout.trim().split('\n').slice(1);
      
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 6 && parts[5] && parts[5] !== '/') {
          const mountPoint = parts[5];
          if (mountPoint.startsWith('/')) {
            drives.push({
              id: mountPoint,
              path: mountPoint,
              name: mountPoint === '/' ? 'Root' : path.basename(mountPoint),
              type: mountPoint.startsWith('/media') ? 'removable' : 'local',
              size: parseInt(parts[1]) * 1024,
              freeSpace: parseInt(parts[3]) * 1024,
              usedSpace: (parseInt(parts[2]) - parseInt(parts[3])) * 1024,
            });
          }
        }
      }
    } catch (err) {
      console.error('Error getting drives:', err);
    }
  }
  
  return drives;
}

async function analyzeDirectory(dirPath: string): Promise<any> {
  const analysis: any = {
    totalFiles: 0,
    totalDirectories: 0,
    totalSize: 0,
    fileTypes: {} as Record<string, { count: number; size: number }>,
    largestFiles: [] as any[],
    recentFiles: [] as any[],
    deletedFiles: 0,
    hiddenFiles: 0,
    permissions: {} as Record<string, number>,
  };
  
  const scanResults = await scanDirectory(dirPath, {
    recursive: true,
    maxDepth: 10,
    currentDepth: 0,
  });
  
  for (const item of scanResults) {
    if (item.type === 'file') {
      analysis.totalFiles++;
      analysis.totalSize += item.size;
      
      if (!analysis.fileTypes[item.fileType]) {
        analysis.fileTypes[item.fileType] = { count: 0, size: 0 };
      }
      analysis.fileTypes[item.fileType].count++;
      analysis.fileTypes[item.fileType].size += item.size;
      
      if (item.isHidden) analysis.hiddenFiles++;
      
      analysis.largestFiles.push({ name: item.name, path: item.path, size: item.size });
      analysis.recentFiles.push({ name: item.name, path: item.path, modified: item.modified });
    } else {
      analysis.totalDirectories++;
    }
  }
  
    analysis.largestFiles.sort((a: any, b: any) => b.size - a.size);
    analysis.largestFiles = analysis.largestFiles.slice(0, 10);
    analysis.recentFiles.sort((a: any, b: any) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  analysis.recentFiles = analysis.recentFiles.slice(0, 10);
  
  return analysis;
}

export async function listDrivesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const drives = await getSystemDrives();
    return reply.send({ data: drives });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to list drives',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function scanPathHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = scanPathSchema.parse(request.body);
    const { 
      path: scanPath, 
      deepScan, 
      recursive, 
      maxDepth, 
      fileTypes,
      dateFilter,
      customDateFrom,
      customDateTo,
      deletedOnly,
      hiddenOnly,
      minSize,
      maxSize,
    } = body;
    
    const exists = fs.existsSync(scanPath);
    if (!exists) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Path does not exist',
      });
    }
    
    const stats = await fs.promises.stat(scanPath);
    if (!stats.isDirectory()) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Path is not a directory',
      });
    }
    
    const dateRange = getDateRange(dateFilter, customDateFrom, customDateTo);
    
    const startTime = Date.now();
    const results = await scanDirectoryWithFilters(scanPath, {
      recursive,
      maxDepth: deepScan ? maxDepth * 2 : maxDepth,
      currentDepth: 0,
      fileTypes,
      dateRange,
      deletedOnly,
      hiddenOnly,
      minSize,
      maxSize,
    });
    const duration = Date.now() - startTime;
    
    const summary = {
      totalItems: results.length,
      files: results.filter(r => r.type === 'file').length,
      directories: results.filter(r => r.type === 'directory').length,
      deletedFiles: results.filter(r => r.deleted).length,
      hiddenFiles: results.filter(r => r.isHidden).length,
      scanDuration: duration,
      scanType: deepScan ? 'deep' : 'quick',
      filters: {
        dateFilter,
        deletedOnly,
        hiddenOnly,
      },
    };
    
    return reply.send({
      data: results.slice(0, 1000),
      summary,
      meta: {
        path: scanPath,
        deepScan,
        recursive,
        maxDepth,
        dateFilter,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to scan path',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

async function scanDirectoryWithFilters(dirPath: string, options: {
  recursive: boolean;
  maxDepth: number;
  currentDepth: number;
  fileTypes?: string[];
  dateRange?: { from?: Date; to?: Date };
  deletedOnly?: boolean;
  hiddenOnly?: boolean;
  minSize?: number;
  maxSize?: number;
}): Promise<any[]> {
  const results: any[] = [];
  
  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      
      try {
        const exists = fs.existsSync(fullPath);
        
        if (options.hiddenOnly && !entry.name.startsWith('.')) continue;
        
        if (entry.isDirectory()) {
          if (options.recursive && options.currentDepth < options.maxDepth) {
            const subResults = await scanDirectoryWithFilters(fullPath, {
              ...options,
              currentDepth: options.currentDepth + 1,
            });
            results.push(...subResults);
          }
        } else {
          let fileStats: fs.Stats;
          try {
            fileStats = await fs.promises.stat(fullPath);
          } catch {
            continue;
          }
          
          if (options.dateRange?.from || options.dateRange?.to) {
            const modTime = new Date(fileStats.mtime);
            if (options.dateRange.from && modTime < options.dateRange.from) continue;
            if (options.dateRange.to && modTime > options.dateRange.to) continue;
          }
          
          if (options.minSize && fileStats.size < options.minSize) continue;
          if (options.maxSize && fileStats.size > options.maxSize) continue;
          
          if (options.fileTypes?.length) {
            const fileType = getFileType(entry.name);
            if (!options.fileTypes.includes(fileType)) continue;
          }
          
          const fileInfo: any = {
            name: entry.name,
            path: fullPath,
            type: 'file',
            size: fileStats.size,
            created: fileStats.birthtime,
            modified: fileStats.mtime,
            accessed: fileStats.atime,
            isHidden: entry.name.startsWith('.'),
            isReadonly: !(fileStats.mode & parseInt('200', 8)),
            permissions: fileStats.mode.toString(8),
            isDirectory: false,
            fileType: getFileType(entry.name),
            extension: path.extname(entry.name).toLowerCase(),
          };
          
          results.push(fileInfo);
        }
      } catch (err) {
        console.error(`Error accessing ${fullPath}:`, err);
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dirPath}:`, err);
  }
  
  return results;
}

export async function analyzePathHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = analyzePathSchema.parse(request.body);
    const { path: analyzePath, analyzeDeleted, analyzeHidden } = body;
    
    const exists = fs.existsSync(analyzePath);
    if (!exists) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Path does not exist',
      });
    }
    
    const analysis = await analyzeDirectory(analyzePath);
    
    return reply.send({
      data: serializeBigInt(analysis),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to analyze path',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getFileInfoHandler(
  request: FastifyRequest<{ Params: { '*': string } }>,
  reply: FastifyReply
) {
  try {
    const filePath = request.params['*'];
    
    if (!filePath) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'File path is required',
      });
    }
    
    const exists = fs.existsSync(filePath);
    if (!exists) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'File or directory not found',
      });
    }
    
    const stats = await fs.promises.stat(filePath);
    const isDirectory = stats.isDirectory();
    
    const fileInfo: any = {
      name: path.basename(filePath),
      path: filePath,
      directory: path.dirname(filePath),
      extension: isDirectory ? null : path.extname(filePath).toLowerCase(),
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory,
      isFile: stats.isFile(),
      isSymbolicLink: stats.isSymbolicLink(),
      permissions: stats.mode.toString(8),
      isReadOnly: !(stats.mode & parseInt('200', 8)),
    };
    
    if (isDirectory) {
      const entries = await fs.promises.readdir(filePath);
      fileInfo.childrenCount = entries.length;
      fileInfo.children = entries.slice(0, 20);
    } else {
      fileInfo.fileType = getFileType(fileInfo.name);
    }
    
    return reply.send({
      data: serializeBigInt(fileInfo),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to get file info',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function deepScanHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = z.object({
      path: z.string().min(1, 'Path is required'),
      options: z.object({
        checkIntegrity: z.boolean().default(true),
        findDuplicates: z.boolean().default(false),
        analyzeMetadata: z.boolean().default(true),
        extractExif: z.boolean().default(false),
      }).optional(),
    }).parse(request.body);
    
    const { path: scanPath, options } = body;
    const exists = fs.existsSync(scanPath);
    if (!exists) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Path does not exist',
      });
    }
    
    const deepAnalysis: any = {
      scanPath,
      startTime: new Date(),
      status: 'in_progress',
      progress: 0,
    };
    
    const allFiles: any[] = [];
    
    const scanResults = await scanDirectory(scanPath, {
      recursive: true,
      maxDepth: 15,
      currentDepth: 0,
    });
    
    deepAnalysis.totalFiles = scanResults.filter(r => r.type === 'file').length;
    deepAnalysis.totalDirectories = scanResults.filter(r => r.type === 'directory').length;
    deepAnalysis.progress = 25;
    
    let totalSize = 0;
    const fileTypes: Record<string, { count: number; size: number }> = {};
    
    for (const file of scanResults) {
      if (file.type === 'file') {
        totalSize += file.size;
        
        if (!fileTypes[file.fileType]) {
          fileTypes[file.fileType] = { count: 0, size: 0 };
        }
        fileTypes[file.fileType].count++;
        fileTypes[file.fileType].size += file.size;
        
        allFiles.push(file);
      }
    }
    
    deepAnalysis.totalSize = totalSize;
    deepAnalysis.fileTypes = fileTypes;
    deepAnalysis.progress = 50;
    
    if (options?.findDuplicates) {
      const hashMap: Record<string, any[]> = {};
      for (const file of allFiles) {
        const key = `${file.size}-${file.extension}`;
        if (!hashMap[key]) hashMap[key] = [];
        hashMap[key].push(file);
      }
      
      const duplicates = Object.values(hashMap).filter(g => g.length > 1);
      deepAnalysis.duplicates = duplicates.slice(0, 100).map(g => ({
        size: g[0].size,
        count: g.length,
        files: g.map(f => f.name),
      }));
    }
    
    deepAnalysis.progress = 75;
    
    if (options?.analyzeMetadata) {
      const metadata = {
        oldestFile: allFiles.reduce((oldest, f) => 
          new Date(f.created) < new Date(oldest.created) ? f : oldest, allFiles[0]),
        newestFile: allFiles.reduce((newest, f) => 
          new Date(f.modified) > new Date(newest.modified) ? f : newest, allFiles[0]),
        averageFileSize: Math.round(totalSize / deepAnalysis.totalFiles),
        largestFile: allFiles.reduce((largest, f) => f.size > largest.size ? f : largest, allFiles[0]),
      };
      deepAnalysis.metadata = metadata;
    }
    
    deepAnalysis.progress = 100;
    deepAnalysis.status = 'completed';
    deepAnalysis.endTime = new Date();
    deepAnalysis.duration = deepAnalysis.endTime - deepAnalysis.startTime;
    
    return reply.send({
      data: serializeBigInt(deepAnalysis),
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to perform deep scan',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function searchFilesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = z.object({
      path: z.string().min(1, 'Path is required'),
      query: z.string().min(1, 'Search query is required'),
      searchInContent: z.boolean().default(false),
      caseSensitive: z.boolean().default(false),
    }).parse(request.body);
    
    const { path: searchPath, query, searchInContent, caseSensitive } = body;
    
    const results: any[] = [];
    const searchTerm = caseSensitive ? query : query.toLowerCase();
    
    async function searchRecursive(dirPath: string, depth: number = 0) {
      if (depth > 10) return;
      
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          const nameToCheck = caseSensitive ? entry.name : entry.name.toLowerCase();
          
          if (nameToCheck.includes(searchTerm)) {
            try {
              const stats = await fs.promises.stat(fullPath);
              results.push({
                name: entry.name,
                path: fullPath,
                type: entry.isDirectory() ? 'directory' : 'file',
                size: stats.size,
                modified: stats.mtime,
              });
            } catch (e) {}
          }
          
          if (entry.isDirectory() && results.length < 100) {
            await searchRecursive(fullPath, depth + 1);
          }
        }
      } catch (e) {}
    }
    
    await searchRecursive(searchPath);
    
    return reply.send({
      data: results.slice(0, 100),
      meta: {
        query,
        path: searchPath,
        totalResults: results.length,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to search files',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function recoverFilesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = recoverFilesSchema.parse(request.body);
    const { filePaths, destination, mode } = body;
    
    if (!fs.existsSync(destination)) {
      fs.mkdirSync(destination, { recursive: true });
    }
    
    const recovered: any[] = [];
    const failed: any[] = [];
    
    for (const filePath of filePaths) {
      try {
        const fileName = path.basename(filePath);
        const destPath = path.join(destination, fileName);
        
        if (fs.existsSync(filePath)) {
          if (mode === 'move') {
            await fs.promises.rename(filePath, destPath);
          } else {
            await fs.promises.copyFile(filePath, destPath);
          }
          
          const stats = await fs.promises.stat(destPath);
          recovered.push({
            originalPath: filePath,
            recoveredPath: destPath,
            filename: fileName,
            size: stats.size,
            status: 'success',
          });
        } else {
          failed.push({
            path: filePath,
            reason: 'File not found (may have been deleted)',
          });
        }
      } catch (err) {
        failed.push({
          path: filePath,
          reason: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }
    
    return reply.send({
      data: {
        recovered,
        failed,
        summary: {
          total: filePaths.length,
          success: recovered.length,
          failed: failed.length,
        },
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to recover files',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function scanDeletedFilesHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = z.object({
      path: z.string().min(1, 'Path is required'),
      scanPath: z.string().optional(),
    }).parse(request.body);
    
    const { path: basePath, scanPath } = body;
    const searchPath = scanPath || basePath;
    
    const deletedFiles: any[] = [];
    
    const scanForDeleted = async (dirPath: string, depth: number = 0) => {
      if (depth > 10) return;
      
      try {
        const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
        
        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name);
          
          try {
            if (entry.isDirectory()) {
              await scanForDeleted(fullPath, depth + 1);
            } else {
              const exists = fs.existsSync(fullPath);
              if (!exists) {
                deletedFiles.push({
                  name: entry.name,
                  path: fullPath,
                  status: 'deleted',
                  lastSeen: new Date().toISOString(),
                });
              }
            }
          } catch (err) {
            console.error(`Error checking ${fullPath}:`, err);
          }
        }
      } catch (err) {
        console.error(`Error reading ${dirPath}:`, err);
      }
    };
    
    await scanForDeleted(searchPath);
    
    return reply.send({
      data: deletedFiles,
      summary: {
        total: deletedFiles.length,
        scannedPath: searchPath,
      },
    });
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Failed to scan for deleted files',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}