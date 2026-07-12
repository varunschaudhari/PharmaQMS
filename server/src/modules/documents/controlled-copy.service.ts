import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AuditAction,
  DocumentVersionState,
  ErrorCode,
  formatVersionLabel,
  type DocVersionCheckData,
} from '@pharmaqms/shared';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import * as QRCode from 'qrcode';
import { AppException } from '../../common/exceptions/app.exception';
import { PdfRenderService } from '../../common/pdf/pdf-render.service';
import { AuditService } from '../../platform/audit/audit.service';
import { QrService } from '../../platform/qr/qr.service';
import { DOCUMENT_ENTITY_TYPE, DOCUMENT_VERSION_ENTITY_TYPE } from './document-entity-types';
import { DocumentsService, type DocumentActor } from './documents.service';

const WATERMARK_TEXT = 'Controlled Copy — verify current version by scanning QR';

// DOC-4/DOC-5: controlled-copy rendering and the public QR version check.
@Injectable()
export class ControlledCopyService {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly qrService: QrService,
    private readonly auditService: AuditService,
    private readonly pdfRenderService: PdfRenderService,
  ) {}

  // DOC-4: stamp header block (doc no., version, effective date), footer watermark, and the
  // version-check QR onto every page of the effective version's PDF. DOCX sources get a
  // controlled cover sheet instead (v1 limitation — the office file cannot be stamped in place).
  async generateControlledCopy(
    tenantId: string,
    actor: DocumentActor,
    versionId: string,
  ): Promise<{ pdf: Buffer; fileName: string }> {
    const version = await this.documentsService.findVersionOrThrow(tenantId, versionId);
    if (version.state !== DocumentVersionState.EFFECTIVE) {
      throw new AppException(
        ErrorCode.VALIDATION_ERROR,
        'Controlled copies can only be printed for the Effective version.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const document = await this.documentsService.findDocumentOrThrow(tenantId, version.documentId.toString());
    const versionLabel = formatVersionLabel(version.majorVersion, version.minorVersion);
    const effectiveDate = version.effectiveDate ? version.effectiveDate.toISOString().slice(0, 10) : '—';

    // DOC-5: the QR on the printed copy identifies the exact VERSION, so a stale print scans as
    // OBSOLETE once superseded.
    const { data: qr } = await this.qrService.getOrCreateForEntity(tenantId, {
      entityType: DOCUMENT_VERSION_ENTITY_TYPE,
      entityId: versionId,
      entityCode: `${document.docNumber} v${versionLabel}`,
      entityName: document.title,
    });
    const qrPng = await QRCode.toBuffer(qr.scanUrl, { type: 'png', width: 240, margin: 1 });

    const header = { docNumber: document.docNumber, versionLabel, effectiveDate, title: document.title };
    const pdf =
      version.fileContentType === 'application/pdf'
        ? await this.stampPdf((await this.documentsService.getVersionFile(tenantId, versionId)).buffer, header, qrPng)
        : await this.renderCoverSheet(header, qr.scanUrl, qrPng);

    // DOC-4: who printed which version, when — a print is a distribution event.
    await this.auditService.record({
      tenantId,
      actor: { userId: actor.userId, fullName: actor.fullName },
      entityType: DOCUMENT_ENTITY_TYPE,
      entityId: document._id.toString(),
      action: AuditAction.CONTROLLED_COPY_PRINTED,
      before: null,
      after: { version: versionLabel, docNumber: document.docNumber },
    });

    return { pdf, fileName: `${document.docNumber}-v${versionLabel}-controlled-copy.pdf` };
  }

  // DOC-5: public version check — no login, no PII (SPEC §7.1: scanning a printed copy shows
  // CURRENT with version + effective date, or OBSOLETE with the current version number).
  async checkVersionByCode(code: string): Promise<DocVersionCheckData> {
    const resolved = await this.qrService.findByCodePublic(code);
    if (!resolved || resolved.entityType !== DOCUMENT_VERSION_ENTITY_TYPE) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Unknown code.', HttpStatus.NOT_FOUND);
    }

    const version = await this.documentsService.findVersionOrThrow(resolved.tenantId, resolved.entityId);
    const document = await this.documentsService.findDocumentOrThrow(resolved.tenantId, version.documentId.toString());
    const documentData = await this.documentsService.toDocumentData(resolved.tenantId, document);

    const scannedVersion = formatVersionLabel(version.majorVersion, version.minorVersion);
    const isCurrent = version.state === DocumentVersionState.EFFECTIVE;

    return {
      status: isCurrent ? 'current' : 'obsolete',
      docNumber: document.docNumber,
      scannedVersion,
      scannedEffectiveDate: version.effectiveDate ? version.effectiveDate.toISOString() : null,
      currentVersion: isCurrent ? null : (documentData.effectiveVersion?.versionLabel ?? null),
      documentId: document._id.toString(),
    };
  }

  private async stampPdf(
    original: Buffer,
    header: { docNumber: string; versionLabel: string; effectiveDate: string; title: string },
    qrPng: Buffer,
  ): Promise<Buffer> {
    const pdf = await PDFDocument.load(original);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const qrImage = await pdf.embedPng(qrPng);

    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();

      // Header block (DOC-4): doc no. | version | effective date, in a top band.
      page.drawRectangle({ x: 0, y: height - 26, width, height: 26, color: rgb(0.95, 0.95, 0.95) });
      page.drawText(`${header.docNumber}  •  Version ${header.versionLabel}  •  Effective ${header.effectiveDate}`, {
        x: 12,
        y: height - 18,
        size: 9,
        font: bold,
        color: rgb(0.1, 0.1, 0.1),
      });

      // Footer watermark + version-check QR (DOC-4/DOC-5).
      page.drawText(WATERMARK_TEXT, { x: 12, y: 14, size: 8, font, color: rgb(0.45, 0.45, 0.45) });
      page.drawImage(qrImage, { x: width - 46, y: 6, width: 40, height: 40 });
    }

    return Buffer.from(await pdf.save());
  }

  private renderCoverSheet(
    header: { docNumber: string; versionLabel: string; effectiveDate: string; title: string },
    scanUrl: string,
    qrPng: Buffer,
  ): Promise<Buffer> {
    const qrDataUrl = `data:image/png;base64,${qrPng.toString('base64')}`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
        * { margin: 0; box-sizing: border-box; } body { font-family: Arial, sans-serif; padding: 20mm; }
        .band { background: #f1f5f9; padding: 6mm; border: 1px solid #cbd5e1; }
        .qr { width: 45mm; height: 45mm; margin-top: 10mm; }
        .watermark { margin-top: 14mm; color: #64748b; font-size: 10pt; }
        @page { size: A4; margin: 0; }
      </style></head><body>
        <div class="band">
          <h1 style="font-size:14pt">${escapeHtml(header.docNumber)} — ${escapeHtml(header.title)}</h1>
          <p style="font-size:11pt;margin-top:2mm">Version ${escapeHtml(header.versionLabel)} • Effective ${escapeHtml(header.effectiveDate)}</p>
        </div>
        <p style="margin-top:10mm">CONTROLLED COPY COVER SHEET — the source document is a Word file;
        attach this sheet to the printed copy. Scan the code below to verify this is the current version.</p>
        <img class="qr" src="${qrDataUrl}" alt="QR" />
        <p style="font-size:9pt;color:#64748b">${escapeHtml(scanUrl)}</p>
        <p class="watermark">${WATERMARK_TEXT}</p>
      </body></html>`;
    return this.pdfRenderService.render(html, { preferCSSPageSize: true });
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
