import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';

dotenv.config();

/**
 * Format phone numbers to WhatsApp international format (E.164 without '+')
 * Default for Bangladesh (+880): converts 017XXXXXXXX or +88017XXXXXXXX to 88017XXXXXXXX
 */
function sanitizeWhatsAppNumber(phone: string): string {
  let cleaned = phone.replace(/[^0-9+]/g, '');
  if (cleaned.startsWith('+')) {
    cleaned = cleaned.substring(1);
  }
  // If Bangladesh local number (e.g. 01711...)
  if (cleaned.startsWith('01') && cleaned.length === 11) {
    cleaned = '88' + cleaned;
  }
  return cleaned;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // ==========================================
  // WHATSAPP BUSINESS CLOUD API ROUTES
  // ==========================================

  // Check WhatsApp Cloud API Configuration Status
  app.get('/api/whatsapp/status', (req, res) => {
    const apiToken = process.env.WHATSAPP_API_TOKEN || '';
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
    const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || '';

    const isConfigured = Boolean(apiToken && phoneNumberId);

    res.json({
      isConfigured,
      hasToken: Boolean(apiToken),
      hasPhoneNumberId: Boolean(phoneNumberId),
      hasBusinessAccountId: Boolean(businessAccountId),
      phoneNumberId: phoneNumberId ? `...${phoneNumberId.slice(-4)}` : null,
    });
  });

  // Send WhatsApp Message (Free-form text, Invoice links, or receipts)
  app.post('/api/whatsapp/send', async (req, res) => {
    const { to, message, type = 'text', invoiceNumber, customerName } = req.body;

    if (!to || !message) {
      return res.status(400).json({
        success: false,
        error: 'Recipient phone number and message body are required.',
      });
    }

    const apiToken = process.env.WHATSAPP_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;

    const formattedRecipient = sanitizeWhatsAppNumber(to);

    if (!apiToken || !phoneNumberId) {
      return res.status(200).json({
        success: false,
        isConfigured: false,
        recipient: formattedRecipient,
        message: 'WhatsApp Business Cloud API credentials are not configured in environment variables (WHATSAPP_API_TOKEN / WHATSAPP_PHONE_NUMBER_ID). Please configure them or use direct WhatsApp link.',
      });
    }

    try {
      const metaUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

      const payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: formattedRecipient,
        type: 'text',
        text: {
          preview_url: true,
          body: message,
        },
      };

      const response = await fetch(metaUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        console.error('Meta WhatsApp Cloud API Error:', data);
        return res.status(response.status).json({
          success: false,
          isConfigured: true,
          error: data.error?.message || 'Failed to send WhatsApp message via Meta Cloud API.',
          details: data.error,
        });
      }

      return res.json({
        success: true,
        isConfigured: true,
        messageId: data.messages?.[0]?.id,
        recipient: formattedRecipient,
        data,
      });
    } catch (err: any) {
      console.error('Server WhatsApp Send Error:', err);
      return res.status(500).json({
        success: false,
        isConfigured: true,
        error: err.message || 'Internal server error while communicating with WhatsApp Cloud API.',
      });
    }
  });

  // Test WhatsApp Cloud API Connectivity
  app.post('/api/whatsapp/test', async (req, res) => {
    const { to } = req.body;
    if (!to) {
      return res.status(400).json({
        success: false,
        error: 'Recipient phone number is required for WhatsApp test.',
      });
    }

    const apiToken = process.env.WHATSAPP_API_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const formattedRecipient = sanitizeWhatsAppNumber(to);

    if (!apiToken || !phoneNumberId) {
      return res.status(200).json({
        success: false,
        isConfigured: false,
        recipient: formattedRecipient,
        message: 'WhatsApp Business Cloud API credentials not configured in .env',
      });
    }

    try {
      const metaUrl = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;
      const testMsg = `🧪 *BASIC AD Digital Printing Press - WhatsApp Business API Test*\n━━━━━━━━━━━━━━━━━━━━\n✅ Connection Status: Active & Authenticated\n🕒 Timestamp: ${new Date().toISOString()}\n\nYour WhatsApp Business Cloud API integration is configured properly and ready to dispatch automatic invoice links and payment receipts!`;

      const response = await fetch(metaUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: formattedRecipient,
          type: 'text',
          text: {
            preview_url: true,
            body: testMsg,
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          isConfigured: true,
          error: data.error?.message || 'Meta API returned error for test message.',
          details: data.error,
        });
      }

      return res.json({
        success: true,
        isConfigured: true,
        messageId: data.messages?.[0]?.id,
        recipient: formattedRecipient,
        data,
      });
    } catch (err: any) {
      return res.status(500).json({
        success: false,
        isConfigured: true,
        error: err.message || 'Internal error during WhatsApp test.',
      });
    }
  });

  // Health check endpoint
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', service: 'BASIC AD ERP & WhatsApp API Server' });
  });

  // ==========================================
  // VITE DEV / PRODUCTION MIDDLEWARE
  // ==========================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BASIC AD Server & WhatsApp Cloud API running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
