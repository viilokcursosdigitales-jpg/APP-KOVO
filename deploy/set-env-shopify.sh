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

add_if_missing "SHOPIFY_API_KEY" "eeb388c650a4342e822dc5dca2fb6b5b"
add_if_missing "SHOPIFY_API_SECRET" "REEMPLAZA_CON_TU_SECRET"
add_if_missing "SHOPIFY_APP_URL" "https://kovo.services"
add_if_missing "SHOPIFY_REDIRECT_URI" "https://kovo.services/api/shopify/callback"
add_if_missing "SHOPIFY_SCOPES" "read_orders,write_orders,read_products,write_products,read_inventory,write_inventory,read_customers,read_analytics,read_reports,read_fulfillments,write_fulfillments,read_shipping,read_locations"
add_if_missing "SHOPIFY_API_VERSION" "2026-04"

echo ""
echo "Listo. Reiniciando PM2..."
pm2 restart all
echo "✅ Servidor reiniciado"
