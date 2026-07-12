import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ErrorCode, type CreateQrCodeRequest, type QrCodeData, type QrResolutionData } from '@pharmaqms/shared';
import { Model } from 'mongoose';
import { randomInt } from 'node:crypto';
import * as QRCode from 'qrcode';
import { AppException } from '../../common/exceptions/app.exception';
import { PdfRenderService } from '../../common/pdf/pdf-render.service';
import { qrConfig, type QrConfig } from './config/qr.config';
import { a4GridLabelHtml, singleLabelHtml } from './label-html';
import { QrCode, QrCodeDocument } from './schemas/qr-code.schema';

// No 0/O/1/I/L/U — unambiguous when read off a printed label (Crockford-style base32 subset).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const CODE_LENGTH = 10;
const MAX_COLLISION_RETRIES = 5;
const MONGO_DUPLICATE_KEY = 11000;

@Injectable()
export class QrService {
  constructor(
    @InjectModel(QrCode.name) private readonly qrCodeModel: Model<QrCodeDocument>,
    private readonly pdfRenderService: PdfRenderService,
    @Inject(qrConfig.KEY) private readonly config: QrConfig,
  ) {}

  // PLT-7: idempotent get-or-create — one code per entity per tenant. Returns `created` so the
  // controller only writes an audit event when a code was actually minted.
  async getOrCreateForEntity(
    tenantId: string,
    dto: CreateQrCodeRequest,
  ): Promise<{ data: QrCodeData; created: boolean }> {
    const existing = await this.qrCodeModel.findOne({
      tenantId,
      entityType: dto.entityType,
      entityId: dto.entityId,
    });
    if (existing) {
      return { data: this.toData(existing), created: false };
    }

    // Collision-safe: the unique index on `code` is the arbiter; on the (astronomically rare)
    // duplicate we mint a fresh code and retry rather than failing the request.
    for (let attempt = 0; ; attempt++) {
      try {
        const doc = await this.qrCodeModel.create({
          tenantId,
          code: this.generateCode(),
          entityType: dto.entityType,
          entityId: dto.entityId,
          entityCode: dto.entityCode,
          entityName: dto.entityName,
        });
        return { data: this.toData(doc), created: true };
      } catch (error) {
        if (!isDuplicateKeyError(error) || attempt >= MAX_COLLISION_RETRIES) {
          throw error;
        }
        // A concurrent request may have created this ENTITY's code (not a code collision) —
        // return it instead of retrying forever against the entity unique index.
        const raced = await this.qrCodeModel.findOne({
          tenantId,
          entityType: dto.entityType,
          entityId: dto.entityId,
        });
        if (raced) {
          return { data: this.toData(raced), created: false };
        }
      }
    }
  }

  // PLT-7 / Iron Rule 5: a code resolves only within the caller's tenant; a foreign or unknown
  // code is indistinguishably NOT_FOUND (never reveal that the code exists elsewhere).
  async resolve(tenantId: string, code: string): Promise<QrResolutionData> {
    const doc = await this.qrCodeModel.findOne({ code, tenantId, isActive: true });
    if (!doc) {
      throw new AppException(ErrorCode.NOT_FOUND, 'QR code not found.', HttpStatus.NOT_FOUND);
    }
    return {
      code: doc.code,
      entityType: doc.entityType,
      entityId: doc.entityId,
      entityCode: doc.entityCode,
      entityName: doc.entityName,
    };
  }

  // DOC-5: capability-URL resolution for the PUBLIC version-check page — the opaque code itself
  // is the access token (SPEC §7.1: "public-ish page, no PII"). Callers decide which entity
  // types may be exposed publicly; everything else must go through the tenant-scoped resolve().
  async findByCodePublic(
    code: string,
  ): Promise<{ tenantId: string; entityType: string; entityId: string } | null> {
    const doc = await this.qrCodeModel.findOne({ code, isActive: true });
    if (!doc) {
      return null;
    }
    return { tenantId: doc.tenantId.toString(), entityType: doc.entityType, entityId: doc.entityId };
  }

  async generatePng(tenantId: string, code: string): Promise<Buffer> {
    const resolution = await this.resolve(tenantId, code);
    return QRCode.toBuffer(this.scanUrl(resolution.code), { type: 'png', width: 480, margin: 2 });
  }

  async generateLabelPdf(tenantId: string, code: string, size: 'single' | 'a4'): Promise<Buffer> {
    const resolution = await this.resolve(tenantId, code);
    const qrDataUrl = await QRCode.toDataURL(this.scanUrl(resolution.code), { width: 360, margin: 1 });
    const content = { qrDataUrl, entityCode: resolution.entityCode, entityName: resolution.entityName };
    const html = size === 'a4' ? a4GridLabelHtml(content) : singleLabelHtml(content);
    // Page size comes from the HTML @page rule in both cases.
    return this.pdfRenderService.render(html, { preferCSSPageSize: true });
  }

  scanUrl(code: string): string {
    return `${this.config.appBaseUrl}/s/${code}`;
  }

  // Overridable seam for collision tests.
  protected generateCode(): string {
    let code = '';
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
    }
    return code;
  }

  private toData(doc: QrCodeDocument): QrCodeData {
    return {
      id: doc._id.toString(),
      tenantId: doc.tenantId.toString(),
      code: doc.code,
      entityType: doc.entityType,
      entityId: doc.entityId,
      entityCode: doc.entityCode,
      entityName: doc.entityName,
      isActive: doc.isActive,
      scanUrl: this.scanUrl(doc.code),
    };
  }
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === MONGO_DUPLICATE_KEY
  );
}
