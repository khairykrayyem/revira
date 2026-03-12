import diabetic from "../assets/diabetic-foot.jpg";
import ingrown from "../assets/ingrown-nail.jpg";
import fungus from "../assets/fungal-nails.jpg";
import dry from "../assets/dry-cracked-feet.jpg";
import wart from "../assets/viral-warts.jpg";
import pedicure from "../assets/medical-pedicure.jpg";

const images = [
  diabetic,
  ingrown,
  fungus,
  dry,
  wart,
  pedicure,
];

function TreatmentsSection({ data }) {
  return (
    <section className="section" id="treatments">
      <div className="container">
        <h2 className="section-title">{data.title}</h2>
        <p className="section-subtitle">{data.subtitle}</p>

        <div className="treatments-grid">
          {data.items.map((item, index) => (
            <div className="card treatment-card" key={index}>
              
              <div className="treatment-image-wrap">
                <img
                  src={images[index]}
                  alt={item.title}
                  className="treatment-image"
                />
                <div className="treatment-overlay"></div>
              </div>

              <div className="treatment-body">
                <div className="treatment-number">
                  {String(index + 1).padStart(2, "0")}
                </div>

                <h3>{item.title}</h3>
                <p>{item.desc}</p>

                <div className="treatment-line"></div>
              </div>

            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default TreatmentsSection;