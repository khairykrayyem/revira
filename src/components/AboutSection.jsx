import aboutImage from "../assets/BACKGROUNDDD.png";

function AboutSection({ data }) {
  return (
    <section
      className="section about-section-bg"
      id="about"
      style={{ backgroundImage: `url(${aboutImage})` }}
    >
      <div className="about-overlay"></div>

      <div className="container about-content-wrapper">
        <h2 className="section-title about-title">{data.title}</h2>
        <p className="section-subtitle about-subtitle">{data.subtitle}</p>

        <div className="card about-box about-glass">
          <p>{data.text1}</p>
          <br />
          <p>{data.text2}</p>
        </div>
      </div>
    </section>
  );
}

export default AboutSection;