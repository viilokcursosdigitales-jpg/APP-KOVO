export default function PrivacyPage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f8fafc',
        color: '#0f172a',
        padding: '40px 16px',
      }}
    >
      <article
        style={{
          maxWidth: 860,
          margin: '0 auto',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 16,
          padding: '28px 24px',
          boxSizing: 'border-box',
          lineHeight: 1.65,
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
          <img
            src="/favicon.png"
            alt="KOVO"
            width={34}
            height={34}
            style={{ borderRadius: 8, objectFit: 'cover' }}
          />
          <div>
            <h1 style={{ margin: 0, fontSize: 26 }}>Política de Privacidad</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>KOVO</p>
          </div>
        </header>

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>Qué datos recopila KOVO</h2>
          <p style={{ margin: 0 }}>
            KOVO recopila los datos necesarios para operar la plataforma: nombre y correo del usuario,
            datos de la tienda Shopify conectada, y datos operativos de comercio como pedidos, productos e
            inventario.
          </p>
        </section>

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>Cómo se usan los datos</h2>
          <p style={{ margin: 0 }}>
            Los datos se usan exclusivamente para mostrar información y funcionalidades dentro del panel de
            KOVO, permitir análisis y apoyar la gestión diaria de la tienda. KOVO no vende los datos a terceros.
          </p>
        </section>

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>Integración con Shopify</h2>
          <p style={{ margin: 0 }}>
            KOVO se integra con Shopify mediante OAuth para acceder a datos autorizados de la tienda y
            sincronizar información relevante para la operación del panel.
          </p>
        </section>

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>Integración con Meta</h2>
          <p style={{ margin: 0 }}>
            KOVO puede conectarse con Meta para la gestión de anuncios y visualización de métricas de campañas
            publicitarias dentro de la plataforma.
          </p>
        </section>

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>Seguridad de los datos</h2>
          <p style={{ margin: 0 }}>
            KOVO aplica medidas técnicas y organizativas razonables para proteger la confidencialidad e
            integridad de los datos. El acceso está limitado a usuarios autenticados y autorizados.
          </p>
        </section>

        <section style={{ marginBottom: 18 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 19 }}>Contacto</h2>
          <p style={{ margin: 0 }}>
            Para consultas sobre privacidad o tratamiento de datos, escribe a{' '}
            <a href="mailto:shopfypartners@outlook.com">shopfypartners@outlook.com</a>.
          </p>
        </section>

        <footer style={{ borderTop: '1px solid #e2e8f0', paddingTop: 14, fontSize: 13, color: '#475569' }}>
          Fecha de última actualización: 29 de abril de 2026
        </footer>
      </article>
    </main>
  );
}
