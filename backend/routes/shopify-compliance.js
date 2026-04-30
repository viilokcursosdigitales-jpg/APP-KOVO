const express = require('express');
const crypto = require('crypto');
const { verifyShopifyWebhookHmac } = require('../shopifyService');

const router = express.Router();

const SHOPIFY_API_SECRET = String(process.env.SHOPIFY_API_SECRET || '').trim();

function parseJsonSafe(rawBody) {
  try {
    return JSON.parse(rawBody.toString('utf8'));
  } catch {
    return null;
  }
}

function handleComplianceWebhook(topic) {
  return (req, res) => {
    const hmacHeader = req.get('X-Shopify-Hmac-Sha256');
    const rawBody = req.rawBody || (Buffer.isBuffer(req.body) ? req.body : null);
    const calculatedHmac =
      rawBody && SHOPIFY_API_SECRET
        ? crypto.createHmac('sha256', SHOPIFY_API_SECRET).update(rawBody).digest('base64')
        : null;
    const isValid =
      Boolean(SHOPIFY_API_SECRET) && Boolean(rawBody) && verifyShopifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET);

    console.log(`[shopify compliance debug] ${topic}`, {
      rawBodyPreview: rawBody ? rawBody.toString('utf8', 0, 100) : null,
      hmacReceived: hmacHeader || null,
      hmacCalculated: calculatedHmac,
      hmacMatch: isValid,
    });

    if (!isValid) {
      return res.status(401).send('Unauthorized');
    }

    const payload = parseJsonSafe(rawBody);
    console.log(`[shopify compliance] ${topic}`, {
      shop: req.get('X-Shopify-Shop-Domain') || null,
      topic: req.get('X-Shopify-Topic') || topic,
      payload,
    });
    return res.status(200).send('OK');
  };
}

router.post('/customers/redact', handleComplianceWebhook('customers/redact'));
router.post('/shop/redact', handleComplianceWebhook('shop/redact'));
router.post('/customers/data_request', handleComplianceWebhook('customers/data_request'));
router.post('/', handleComplianceWebhook('base'));

module.exports = router;
