import clinic from "../assets/clinic.jpg";

function HeroSection({ data }) {
  return (
    <section className="hero section" id="home">
      <div className="container hero-content">
        <div className="hero-text">
          <div className="hero-badge">{data.badge}</div>

          <h1>
            {data.title[0]}
            <br />
            {data.title[1]}
            <br />
            {data.title[2]}
          </h1>

          <p>{data.text}</p>

          <div className="hero-buttons">
            <a href="#booking" className="btn btn-primary">
              {data.book}
            </a>

            <a
              href="https://wa.me/972507006005"
              target="_blank"
              rel="noreferrer"
              className="btn btn-secondary"
            >
              {data.whatsapp}
            </a>
          </div>

          <div className="hero-stats">
            {data.stats.map((item, index) => (
              <div className="hero-stat" key={index}>
                <span>{item.value}</span>
                <small>{item.label}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="hero-image">
          <div className="hero-image-glow"></div>
          <div className="hero-image-box">
            <img src={clinic} alt="REVIRA Clinic" />
          </div>
        </div>
      </div>
    </section>
  );
}

export default HeroSection;