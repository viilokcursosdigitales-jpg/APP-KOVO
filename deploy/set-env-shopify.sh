#!/bin/bash

ENV_FILE="$(dirname "$0")/../backend/.env"

add_if_missing() {
  local key=$1
  local value=$2
  if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    echo "${key}=${value}" >> "$ENV_FILE"
    echo "✅ Agregado: $key"
  else
    echo "⏭️  Ya existe: $key"
  fi
}

# App 1 (María / anih3t-x9): NO cambiar SHOPIFY_API_KEY ni SHOPIFY_API_SECRET.
add_if_missing "SHOPIFY_API_KEY" "eeb388c650a4342e822dc5dca2fb6b5b"
add_if_missing "SHOPIFY_API_SECRET" "REEMPLAZA_CON_TU_SECRET"
# App 2 (kovo-2-publica): clientes nuevos vía ?app=2 — NO usar este Client ID en SHOPIFY_API_KEY.
add_if_missing "SHOPIFY_API_KEY_2" "REEMPLAZA_CLIENT_ID_KOVO_2_PUBLICA"
add_if_missing "SHOPIFY_API_SECRET_2" "REEMPLAZA_SECRET_KOVO_2_PUBLICA"
add_if_missing "SHOPIFY_APP_URL" "https://kovo.services"
add_if_missing "SHOPIFY_REDIRECT_URI" "https://kovo.services/api/shopify/callback"
add_if_missing "SHOPIFY_SCOPES" "read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_customers,read_analytics,read_reports,read_fulfillments,write_fulfillments,read_shipping,read_locations"
add_if_missing "SHOPIFY_API_VERSION" "2026-04"

echo ""
echo "Listo. Reiniciando PM2..."
pm2 restart all
echo "✅ Servidor reiniciado"
