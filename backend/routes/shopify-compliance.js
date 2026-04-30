const express = require('express');
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
    if (!SHOPIFY_API_SECRET || !rawBody || !verifyShopifyWebhookHmac(rawBody, hmacHeader, SHOPIFY_API_SECRET)) {
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

module.exports = router;
