import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { launch, type Browser, type PDFOptions } from 'puppeteer';

// PLT-7 / DOC-4: server-side HTML -> PDF rendering (CLAUDE.md stack: puppeteer). One lazily
// launched headless browser shared across renders; each render gets a fresh page.
@Injectable()
export class PdfRenderService implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRenderService.name);
  private browserPromise: Promise<Browser> | null = null;

  private getBrowser(): Promise<Browser> {
    if (!this.browserPromise) {
      this.logger.log('Launching headless browser for PDF rendering…');
      this.browserPromise = launch({ headless: true });
    }
    return this.browserPromise;
  }

  async render(html: string, options: PDFOptions): Promise<Buffer> {
    const browser = await this.getBrowser();
    const page = await browser.newPage();
    try {
      await page.setContent(html, { waitUntil: 'load' });
      const pdf = await page.pdf({ printBackground: true, ...options });
      return Buffer.from(pdf);
    } finally {
      await page.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browserPromise) {
      const browser = await this.browserPromise;
      await browser.close();
      this.browserPromise = null;
    }
  }
}
