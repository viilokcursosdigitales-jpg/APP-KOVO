-- Dashboard editorial content module

CREATE TABLE IF NOT EXISTS dashboard_content (
  id SERIAL PRIMARY KEY,
  type VARCHAR(20) NOT NULL CHECK (type IN ('banner', 'alert', 'news')),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  image_url TEXT,
  link_url TEXT,
  link_text TEXT,
  color VARCHAR(20) NOT NULL DEFAULT 'blue' CHECK (color IN ('green', 'yellow', 'red', 'blue')),
  active BOOLEAN NOT NULL DEFAULT true,
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dashboard_content_active_order ON dashboard_content (active, order_index, id);

INSERT INTO dashboard_content (type, title, description, image_url, link_url, link_text, color, active, order_index)
VALUES
  (
    'banner',
    'Bienvenido a KOVO',
    'Tu panel de gestión ya está listo. Organiza campañas, pedidos e inventario desde un solo lugar.',
    'https://images.unsplash.com/photo-1557804506-669a67965ba0?auto=format&fit=crop&w=1400&q=80',
    '/dashboard',
    'Ir al panel',
    'blue',
    true,
    1
  ),
  (
    'alert',
    'Configura tus canales',
    'Conecta Meta Ads y revisa que tus módulos estén habilitados para empezar con datos completos.',
    NULL,
    '/canales',
    'Abrir canales',
    'yellow',
    true,
    2
  ),
  (
    'news',
    'Nuevas mejoras en el panel',
    'Explora el nuevo módulo de usuarios registrados y mantente al día con las actualizaciones de KOVO.',
    NULL,
    '/admin/users',
    'Ver módulo',
    'blue',
    true,
    3
  )
ON CONFLICT DO NOTHING;
