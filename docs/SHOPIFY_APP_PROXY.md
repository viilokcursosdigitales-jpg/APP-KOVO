# App Proxy — formulario COD en Shopify

El storefront llama a `/apps/kovo-form` (misma tienda). Shopify reenvía la petición a Kovo con firma HMAC; el token de ingesta **no** va en el navegador.

## Configuración en Shopify Partners

En **App setup → App proxy**:

| Campo | Valor |
|--------|--------|
| Subpath prefix | `apps` |
| Subpath | `kovo-form` |
| Proxy URL | `https://kovo.services/api/shopify-proxy/form` |

URL en la tienda: `https://{shop}.myshopify.com/apps/kovo-form`

## Requisitos en Kovo

1. Tienda conectada por OAuth (o manual-connect) → se guarda `organizations.shopify_shop_domain`.
2. Token de ingesta generado: `POST /api/organizations/:id/ingest-token` (JWT owner/admin).

## Formulario en el tema

```javascript
fetch('/apps/kovo-form', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    client_name: 'María García',
    phone: '3001234567',
    address1: 'Calle 10 # 20-30',
    city: 'Bogotá',
    province: 'Cundinamarca',
    country: 'Colombia',
    total: 149900,
    currency: 'COP',
    financial_status: 'pending',
    note: 'Formulario COD',
    line_items: [
      {
        product_id: 123456789,
        variant_id: 987654321,
        title: 'Producto',
        variant_title: 'Talla M',
        quantity: 1,
      },
    ],
  }),
})
  .then((r) => r.json())
  .then((data) => {
    if (data.ok) console.log('Pedido creado:', data.order_id);
    else console.error(data.error);
  });
```

## Respuesta

- **201**: `{ "ok": true, "order_id": "motico_manual:123" }`
- **401**: firma o timestamp inválido
- **404**: tienda no vinculada a una organización
- **503**: falta token de ingesta (`ingest_token_missing`)

## Endpoint directo (proxy / servidor)

Solo si llamas Kovo sin pasar por Shopify (p. ej. worker propio):

```http
POST https://kovo.services/api/ingest/shopify-form
x-kovo-ingest-token: kovo_ingest_...
```

## Variables de entorno

- `SHOPIFY_API_SECRET` — secreto de la app (firma del proxy)
- `SHOPIFY_PROXY_TIMESTAMP_MAX_SKEW_SEC` — opcional, default 86400 (24 h)
