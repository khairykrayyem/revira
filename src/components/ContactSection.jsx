function ContactSection({ data }) {
  return (
    <section className="section" id="contact">
      <div className="container">
        <h2 className="section-title">{data.title}</h2>
        <p className="section-subtitle">{data.subtitle}</p>

        <div className="contact-grid">
          <div className="card contact-card">
            <h3>{data.addressTitle}</h3>
            <p>{data.address1}</p>
            <p>{data.address2}</p>
          </div>

          <div className="card contact-card">
            <h3>{data.phoneTitle}</h3>
            <a href="tel:0507006005">050-700-6005</a>
            <br />
            <a href="https://wa.me/972507006005" target="_blank" rel="noreferrer">
              {data.phoneBtn}
            </a>
          </div>

          <div className="card contact-card">
            <h3>{data.hoursTitle}</h3>
            <p>{data.days}</p>
            <p>{data.hours}</p>
          </div>
        </div>

        <div className="footer">{data.footer}</div>
      </div>
    </section>
  );
}

export default ContactSection;