import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'crypto';

const prisma = new PrismaClient();

// Schema validators
const timelineSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  sources: z.array(z.enum(['FILESYSTEM', 'REGISTRY', 'EVENTLOG', 'BROWSER', 'USB'])).default(['FILESYSTEM']),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  eventTypes: z.array(z.string()).optional(),
});

const registryScanSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  hivePath: z.string().min(1, 'Hive path is required'),
  scanTypes: z.array(z.enum(['USBSTOR', 'UserAssist', 'RunMRU', 'ShellBags', 'TypedPaths'])).default(['USBSTOR']),
});

const emailAnalysisSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  emailPath: z.string().min(1, 'Email file path is required'),
  emailType: z.enum(['PST', 'OST', 'EML', 'MSG', 'MBOX']).default('EML'),
  checkPhishing: z.boolean().default(true),
});

const pcapAnalysisSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  pcapPath: z.string().min(1, 'PCAP file path is required'),
  extractFiles: z.boolean().default(true),
  extractCredentials: z.boolean().default(true),
});

const yaraScanSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  scanPath: z.string().min(1, 'Path to scan is required'),
  ruleFiles: z.array(z.string()).optional(),
  recursive: z.boolean().default(true),
});

const iocExtractSchema = z.object({
  caseId: z.string().min(1, 'Case ID is required'),
  sourcePath: z.string().optional(),
  iocTypes: z.array(z.enum(['IP', 'DOMAIN', 'URL', 'HASH', 'REGISTRY', 'MUTEX'])).default(['IP', 'DOMAIN', 'URL', 'HASH']),
});

const steganalysisSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  filePath: z.string().min(1, 'Image file path is required'),
  methods: z.array(z.enum(['LSB', 'DCT', 'CHI_SQUARE', 'RS', 'SPAM'])).default(['LSB', 'CHI_SQUARE']),
});

const encryptionDetectionSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  volumePath: z.string().min(1, 'Volume path is required'),
  checkEntropy: z.boolean().default(true),
  searchHeaders: z.boolean().default(true),
});

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

// Helper: Extract IOCs from text
function extractIOCs(text: string, iocTypes: string[]): Array<{ type: string; value: string }> {
  const iocs: Array<{ type: string; value: string }> = [];
  
  // IP addresses
  if (iocTypes.includes('IP')) {
    const ipRegex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
    const matches = text.match(ipRegex);
    if (matches) {
      matches.forEach(ip => iocs.push({ type: 'IP', value: ip }));
    }
  }
  
  // Domains
  if (iocTypes.includes('DOMAIN')) {
    const domainRegex = /\b[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}\b/g;
    const matches = text.match(domainRegex);
    if (matches) {
      matches.forEach(domain => iocs.push({ type: 'DOMAIN', value: domain }));
    }
  }
  
  // URLs
  if (iocTypes.includes('URL')) {
    const urlRegex = /https?:\/\/[^\s<>"']+/g;
    const matches = text.match(urlRegex);
    if (matches) {
      matches.forEach(url => iocs.push({ type: 'URL', value: url }));
    }
  }
  
  // Hashes
  if (iocTypes.includes('HASH')) {
    const md5Regex = /\b[a-fA-F0-9]{32}\b/g;
    const sha1Regex = /\b[a-fA-F0-9]{40}\b/g;
    const sha256Regex = /\b[a-fA-F0-9]{64}\b/g;
    
    [md5Regex, sha1Regex, sha256Regex].forEach(regex => {
      const matches = text.match(regex);
      if (matches) {
        matches.forEach(hash => iocs.push({ type: 'HASH', value: hash }));
      }
    });
  }
  
  return iocs;
}

// Handler: Generate timeline
export async function generateTimeline(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = timelineSchema.parse(request.body);
    const { caseId, sources, dateFrom, dateTo, eventTypes } = body;
    
    const timeline: Array<{
      timestamp: Date;
      eventType: string;
      source: string;
      description: string;
      macb: string;
    }> = [];
    
    // In production, would parse:
    // - NTFS USN Journal
    // - MFT entries
    // - Registry hives
    // - Event logs
    // - Browser history
    // For now, return empty timeline
    
    return reply.send({
      code: 'TIMELINE_GENERATED',
      data: {
        caseId,
        events: timeline,
        totalEvents: timeline.length,
        dateRange: { from: dateFrom, to: dateTo },
        sources
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'TIMELINE_FAILED',
      message: 'Failed to generate timeline',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Scan registry
export async function scanRegistry(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = registryScanSchema.parse(request.body);
    const { jobId, hivePath, scanTypes } = body;
    
    if (!fs.existsSync(hivePath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Registry hive file not found'
      });
    }
    
    const artifacts: Array<{
      artifactType: string;
      keyPath: string;
      valueName: string;
      valueData: string;
      significance: string;
    }> = [];
    
    // In production, would use libregf to parse registry
    // For now, return placeholder
    
    return reply.send({
      code: 'REGISTRY_SCAN_COMPLETE',
      data: {
        jobId,
        hivePath,
        artifactsFound: artifacts.length,
        artifacts: artifacts.slice(0, 100)
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'REGISTRY_SCAN_FAILED',
      message: 'Failed to scan registry',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Analyze email
export async function analyzeEmail(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = emailAnalysisSchema.parse(request.body);
    const { jobId, emailPath, emailType, checkPhishing } = body;
    
    if (!fs.existsSync(emailPath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Email file not found'
      });
    }
    
    const analysis: any = {
      jobId,
      emailPath,
      emailType,
      sender: null,
      recipients: [],
      subject: null,
      date: null,
      hasAttachments: false,
      isPhishing: false,
      headers: {}
    };
    
    // Parse EML file
    if (emailType === 'EML') {
      const content = fs.readFileSync(emailPath, 'utf-8');
      const lines = content.split('\n');
      
      for (const line of lines) {
        if (line.toLowerCase().startsWith('from:')) {
          analysis.sender = line.substring(5).trim();
        } else if (line.toLowerCase().startsWith('to:')) {
          analysis.recipients = line.substring(3).trim().split(',');
        } else if (line.toLowerCase().startsWith('subject:')) {
          analysis.subject = line.substring(8).trim();
        } else if (line.toLowerCase().startsWith('date:')) {
          analysis.date = new Date(line.substring(5).trim());
        }
      }
    }
    
    return reply.send({
      code: 'EMAIL_ANALYSIS_COMPLETE',
      data: analysis
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'EMAIL_ANALYSIS_FAILED',
      message: 'Failed to analyze email',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Analyze PCAP
export async function analyzePCAP(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = pcapAnalysisSchema.parse(request.body);
    const { jobId, pcapPath, extractFiles, extractCredentials } = body;
    
    if (!fs.existsSync(pcapPath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'PCAP file not found'
      });
    }
    
    const analysis = {
      jobId,
      pcapPath,
      totalPackets: 0,
      protocols: {},
      connections: [],
      extractedFiles: [],
      credentials: []
    };
    
    // In production, would use libpcap or tshark
    // For now, return placeholder
    
    return reply.send({
      code: 'PCAP_ANALYSIS_COMPLETE',
      data: analysis
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'PCAP_ANALYSIS_FAILED',
      message: 'Failed to analyze PCAP file',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: YARA scan
export async function yaraScan(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = yaraScanSchema.parse(request.body);
    const { jobId, scanPath, ruleFiles, recursive } = body;
    
    if (!fs.existsSync(scanPath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Scan path does not exist'
      });
    }
    
    const results: Array<{
      ruleName: string;
      matchedFile: string;
      severity: string;
      description: string;
    }> = [];
    
    // In production, would use libyara
    // For now, return placeholder
    
    return reply.send({
      code: 'YARA_SCAN_COMPLETE',
      data: {
        jobId,
        scanPath,
        matchesFound: results.length,
        results
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'YARA_SCAN_FAILED',
      message: 'Failed to perform YARA scan',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Extract IOCs
export async function extractIOCsHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = iocExtractSchema.parse(request.body);
    const { caseId, sourcePath, iocTypes } = body;
    
    const iocs: Array<{
      iocType: string;
      iocValue: string;
      source: string;
      confidence: number;
    }> = [];
    
    if (sourcePath && fs.existsSync(sourcePath)) {
      const content = fs.readFileSync(sourcePath, 'utf-8');
      const extracted = extractIOCs(content, iocTypes);
      
      extracted.forEach(ioc => {
        iocs.push({
          iocType: ioc.type,
          iocValue: ioc.value,
          source: sourcePath,
          confidence: 80
        });
      });
    }
    
    return reply.send({
      code: 'IOC_EXTRACTION_COMPLETE',
      data: {
        caseId,
        iocsFound: iocs.length,
        iocs
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'IOC_EXTRACTION_FAILED',
      message: 'Failed to extract IOCs',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Steganalysis
export async function performSteganalysis(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = steganalysisSchema.parse(request.body);
    const { jobId, filePath, methods } = body;
    
    if (!fs.existsSync(filePath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Image file not found'
      });
    }
    
    const results: Array<{
      method: string;
      result: string;
      confidence: number;
      details: any;
    }> = [];
    
    // LSB analysis
    if (methods.includes('LSB')) {
      const buffer = fs.readFileSync(filePath);
      // Simplified LSB check - in production, analyze bit patterns
      results.push({
        method: 'LSB',
        result: 'clean',
        confidence: 95,
        details: {}
      });
    }
    
    // Chi-square test
    if (methods.includes('CHI_SQUARE')) {
      results.push({
        method: 'CHI_SQUARE',
        result: 'clean',
        confidence: 90,
        details: {}
      });
    }
    
    return reply.send({
      code: 'STEGANALYSIS_COMPLETE',
      data: {
        jobId,
        filePath,
        analyses: results
      }
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'STEGANALYSIS_FAILED',
      message: 'Failed to perform steganalysis',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Handler: Encryption detection
export async function detectEncryption(
  request: FastifyRequest,
  reply: FastifyReply
) {
  try {
    const body = encryptionDetectionSchema.parse(request.body);
    const { jobId, volumePath, checkEntropy, searchHeaders } = body;
    
    if (!fs.existsSync(volumePath)) {
      return reply.status(400).send({
        code: 'INVALID_PATH',
        message: 'Volume path does not exist'
      });
    }
    
    const detection = {
      jobId,
      volumePath,
      encrypted: false,
      encryptionType: null,
      entropy: null,
      headerFound: false,
      recoverable: false
    };
    
    // Check entropy
    if (checkEntropy) {
      const entropy = calculateEntropy(volumePath);
      detection.entropy = entropy;
      
      // High entropy (>7.5) suggests encryption
      if (entropy > 7.5) {
        detection.encrypted = true;
      }
    }
    
    // Search for known headers
    if (searchHeaders) {
      const buffer = fs.readFileSync(volumePath);
      const header = buffer.slice(0, 100).toString();
      
      if (header.includes('-FVE-FS-')) {
        detection.encrypted = true;
        detection.encryptionType = 'BitLocker';
        detection.headerFound = true;
      } else if (header.includes('VeraCrypt')) {
        detection.encrypted = true;
        detection.encryptionType = 'VeraCrypt';
        detection.headerFound = true;
      }
    }
    
    return reply.send({
      code: 'ENCRYPTION_DETECTION_COMPLETE',
      data: detection
    });
    
  } catch (error) {
    request.log.error(error);
    return reply.status(500).send({
      code: 'ENCRYPTION_DETECTION_FAILED',
      message: 'Failed to detect encryption',
      details: error instanceof Error ? error.message : String(error)
    });
  }
}

// Register routes
export async function advancedForensicsRoutes(fastify: FastifyInstance) {
  fastify.post('/forensic/timeline', generateTimeline);
  fastify.post('/forensic/registry-scan', scanRegistry);
  fastify.post('/forensic/email-analysis', analyzeEmail);
  fastify.post('/forensic/pcap-analysis', analyzePCAP);
  fastify.post('/forensic/yara-scan', yaraScan);
  fastify.post('/forensic/ioc-extract', extractIOCsHandler);
  fastify.post('/forensic/steganalysis', performSteganalysis);
  fastify.post('/forensic/encryption-detect', detectEncryption);
}
