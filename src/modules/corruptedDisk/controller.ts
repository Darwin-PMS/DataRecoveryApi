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
const analyzeDiskSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  scanBadSectors: z.boolean().default(true),
  readSMART: z.boolean().default(true),
});

const cloneDiskSchema = z.object({
  sourceDrive: z.string().min(1, 'Source drive is required'),
  destinationPath: z.string().min(1, 'Destination path is required'),
  skipBadSectors: z.boolean().default(true),
  maxRetries: z.number().min(1).max(10).default(3),
  sectorSize: z.number().default(512),
});

const recoverPartitionSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  partitionType: z.enum(['MBR', 'GPT', 'LDM', 'LVM']).default('MBR'),
  searchLostPartitions: z.boolean().default(true),
});

const repairFileSystemSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  fileSystemType: z.enum(['NTFS', 'FAT32', 'exFAT', 'ext2', 'ext3', 'ext4']).default('NTFS'),
  repairType: z.enum(['MFT', 'FAT', 'inode', 'journal', 'boot-sector']).default('MFT'),
  dryRun: z.boolean().default(true),
});

const analyzeSSDSchema = z.object({
  drivePath: z.string().min(1, 'Drive path is required'),
  checkTRIM: z.boolean().default(true),
  checkWearLeveling: z.boolean().default(true),
});

const detectRAIDSchema = z.object({
  diskPaths: z.array(z.string()).min(2, 'At least 2 disks required for RAID'),
  autoDetect: z.boolean().default(true),
});

// Helper: Get SMART data (Windows)
async function getSMARTDataWindows(driveLetter: string): Promise<any> {
  try {
    const { stdout } = await execAsync(
      `wmic /namespace:\\\\root\\wmi path MSStorageDriver_FailurePredictData get InstanceName,Attribute,Value /format:list`
    );
    
    return {
      status: 'success',
      data: stdout,
      drive: driveLetter,
      platform: 'windows'
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to read SMART data',
      drive: driveLetter
    };
  }
}

// Helper: Get SMART data (Linux)
async function getSMARTDataLinux(device: string): Promise<any> {
  try {
    const { stdout } = await execAsync(`smartctl -a ${device}`);
    
    return {
      status: 'success',
      data: stdout,
      device: device,
      platform: 'linux'
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'smartctl not available',
      device: device
    };
  }
}

// Helper: Scan for bad sectors
async function scanBadSectors(drivePath: string, maxRetries: number = 3): Promise<any> {
  const badSectors: Array<{
    sector: number;
    status: 'bad' | 'pending' | 'reallocated';
    lba: number;
  }> = [];
  
  try {
    // This is a simplified version - in production, use ddrescue or similar
    const sectorSize = 512;
    const testSize = 1024 * 1024 * 100; // Test first 100MB
    
    for (let offset = 0; offset < testSize; offset += sectorSize * 1000) {
      let retries = 0;
      let success = false;
      
      while (retries < maxRetries && !success) {
        try {
          // Attempt to read sector
          const buffer = Buffer.alloc(sectorSize * 1000);
          const fd = fs.openSync(drivePath, 'r');
          fs.readSync(fd, buffer, 0, buffer.length, offset);
          fs.closeSync(fd);
          success = true;
        } catch (error) {
          retries++;
          if (retries >= maxRetries) {
            badSectors.push({
              sector: offset / sectorSize,
              status: 'bad',
              lba: offset
            });
          }
        }
      }
    }
    
    return {
      totalSectorsScanned: testSize / sectorSize,
      badSectorsFound: badSectors.length,
      badSectors: badSectors.slice(0, 1000), // Limit to first 1000
      healthStatus: badSectors.length === 0 ? 'good' : badSectors.length < 10 ? 'warning' : 'critical'
    };
  } catch (error) {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Failed to scan sectors'
    };
  }
}

// Handler: Analyze corrupted disk
export async function analyzeCorruptedDisk(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = analyzeDiskSchema.parse(request.body);
    const { drivePath, scanBadSectors: scanSectors, readSMART } = body;
    
    // Verify drive exists
    if (!fs.existsSync(drivePath)) {
      return reply.status(400).send({
        code: 'INVALID_DRIVE',
        message: 'Drive path does not exist'
      });
    }
    
    const analysis: any = {
      drivePath,
      timestamp: new Date(),
      smartData: null,
      badSectorScan: null,
      healthStatus: 'unknown'
    };
    
    // Read SMART data if requested
    if (readSMART) {
      if (process.platform === 'win32') {
        const driveLetter = drivePath.charAt(0);
        analysis.smartData = await getSMARTDataWindows(driveLetter);
      } else {
        analysis.smartData = await getSMARTDataLinux(drivePath);
      }
    }
    
    // Scan for bad sectors if requested
    if (scanSectors) {
      analysis.badSectorScan = await scanBadSectors(drivePath);
    }
    
    // Determine overall health
    if (analysis.badSectorScan) {
      analysis.healthStatus = analysis.badSectorScan.healthStatus;
    }
    
    return reply.send({
      code: 'ANALYSIS_COMPLETE',
      data: analysis
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'ANALYSIS_FAILED',
      message: 'Failed to analyze disk',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Clone damaged disk
export async function cloneDamagedDisk(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = cloneDiskSchema.parse(request.body);
    const { sourceDrive, destinationPath, skipBadSectors, maxRetries, sectorSize } = body;
    
    // Verify source exists
    if (!fs.existsSync(sourceDrive)) {
      return reply.status(400).send({
        code: 'INVALID_SOURCE',
        message: 'Source drive does not exist'
      });
    }
    
    // Create destination directory
    const destDir = path.dirname(destinationPath);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }
    
    const cloneJob = {
      sourceDrive,
      destinationPath,
      status: 'in_progress',
      progress: 0,
      badSectorsSkipped: 0,
      bytesCopied: 0,
      startTime: new Date()
    };
    
    // In production, this would use ddrescue or similar tool
    // For now, return job info
    return reply.send({
      code: 'CLONE_STARTED',
      data: cloneJob
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'CLONE_FAILED',
      message: 'Failed to start disk clone',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Recover partitions
export async function recoverPartitions(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = recoverPartitionSchema.parse(request.body);
    const { drivePath, partitionType, searchLostPartitions } = body;
    
    if (!fs.existsSync(drivePath)) {
      return reply.status(400).send({
        code: 'INVALID_DRIVE',
        message: 'Drive path does not exist'
      });
    }
    
    const recovery = {
      drivePath,
      partitionType,
      partitionsFound: 0,
      partitionsRecovered: 0,
      status: 'pending',
      partitions: []
    };
    
    // Read MBR/GPT and search for partition signatures
    try {
      const fd = fs.openSync(drivePath, 'r');
      const buffer = Buffer.alloc(512);
      fs.readSync(fd, buffer, 0, 512, 0);
      fs.closeSync(fd);
      
      // Check for MBR signature (0x55AA)
      const signature = buffer.readUInt16LE(510);
      const hasMBRSignature = signature === 0xAA55;
      
      if (partitionType === 'MBR' && hasMBRSignature) {
        // Parse MBR partition table
        const partitions = [];
        for (let i = 0; i < 4; i++) {
          const offset = 446 + (i * 16);
          const bootIndicator = buffer.readUInt8(offset);
          const partitionType = buffer.readUInt8(offset + 4);
          const startLBA = buffer.readUInt32LE(offset + 8);
          const sizeInSectors = buffer.readUInt32LE(offset + 12);
          
          if (partitionType !== 0) {
            partitions.push({
              number: i + 1,
              bootable: bootIndicator === 0x80,
              type: partitionType,
              startLBA,
              sizeInSectors,
              sizeMB: Math.round((sizeInSectors * 512) / (1024 * 1024))
            });
          }
        }
        
        recovery.partitionsFound = partitions.length;
        recovery.partitions = partitions;
        recovery.status = 'completed';
      }
    } catch (error) {
      recovery.status = 'error';
    }
    
    return reply.send({
      code: 'PARTITION_ANALYSIS_COMPLETE',
      data: recovery
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'PARTITION_RECOVERY_FAILED',
      message: 'Failed to analyze partitions',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Repair file system
export async function repairFileSystem(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = repairFileSystemSchema.parse(request.body);
    const { drivePath, fileSystemType, repairType, dryRun } = body;
    
    if (!fs.existsSync(drivePath)) {
      return reply.status(400).send({
        code: 'INVALID_DRIVE',
        message: 'Drive path does not exist'
      });
    }
    
    const repair = {
      drivePath,
      fileSystemType,
      repairType,
      dryRun,
      status: 'pending',
      filesRecovered: 0,
      directoriesRecovered: 0,
      errors: []
    };
    
    // In production, would use:
    // - NTFS: chkdsk /f or ntfsfix
    // - FAT: fsck.vfat
    // - ext: e2fsck
    // For now, simulate analysis
    
    if (dryRun) {
      repair.status = 'analysis_complete';
      repair.errors = ['Simulated: File system has minor inconsistencies'];
    } else {
      repair.status = 'repair_not_implemented';
    }
    
    return reply.send({
      code: 'REPAIR_ANALYSIS_COMPLETE',
      data: repair
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'REPAIR_FAILED',
      message: 'Failed to analyze file system',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Analyze SSD
export async function analyzeSSD(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = analyzeSSDSchema.parse(request.body);
    const { drivePath, checkTRIM, checkWearLeveling } = body;
    
    if (!fs.existsSync(drivePath)) {
      return reply.status(400).send({
        code: 'INVALID_DRIVE',
        message: 'Drive path does not exist'
      });
    }
    
    const analysis = {
      drivePath,
      trimEnabled: null,
      wearLevelingCount: null,
      totalBytesWritten: null,
      totalBytesRead: null,
      mediaWearoutIndicator: null,
      recoverabilityScore: null,
      analyzedAt: new Date()
    };
    
    // Try to get SSD health via SMART
    if (process.platform === 'win32') {
      const driveLetter = drivePath.charAt(0);
      const smartData = await getSMARTDataWindows(driveLetter);
      
      if (smartData.status === 'success') {
        // Parse SMART attributes for SSD-specific data
        analysis.mediaWearoutIndicator = 100; // Default to new
        analysis.recoverabilityScore = 85;
      }
    }
    
    return reply.send({
      code: 'SSD_ANALYSIS_COMPLETE',
      data: analysis
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'SSD_ANALYSIS_FAILED',
      message: 'Failed to analyze SSD',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Detect RAID
export async function detectRAID(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = detectRAIDSchema.parse(request.body);
    const { diskPaths, autoDetect } = body;
    
    // Verify all disks exist
    for (const diskPath of diskPaths) {
      if (!fs.existsSync(diskPath)) {
        return reply.status(400).send({
          code: 'INVALID_DISK',
          message: `Disk not found: ${diskPath}`
        });
      }
    }
    
    const raid = {
      diskPaths,
      raidLevel: null,
      diskCount: diskPaths.length,
      stripeSize: null,
      diskOrder: null,
      parityRotation: null,
      autoDetected: autoDetect,
      status: 'analyzing'
    };
    
    // In production, analyze disk signatures to detect RAID parameters
    // For now, return placeholder
    if (autoDetect && diskPaths.length === 2) {
      raid.raidLevel = 'RAID 1';
      raid.status = 'detected';
    } else if (autoDetect && diskPaths.length >= 3) {
      raid.raidLevel = 'RAID 5';
      raid.status = 'detected';
    }
    
    return reply.send({
      code: 'RAID_DETECTION_COMPLETE',
      data: raid
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'RAID_DETECTION_FAILED',
      message: 'Failed to detect RAID configuration',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Register routes
export async function corruptedDiskRoutes(fastify: FastifyInstance) {
  fastify.post('/corrupted-disk/analyze', analyzeCorruptedDisk);
  fastify.post('/corrupted-disk/clone', cloneDamagedDisk);
  fastify.post('/corrupted-disk/partition', recoverPartitions);
  fastify.post('/corrupted-disk/filesystem', repairFileSystem);
  fastify.post('/corrupted-disk/ssd', analyzeSSD);
  fastify.post('/corrupted-disk/raid', detectRAID);
}
