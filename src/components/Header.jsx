import logo from "../assets/logo.png";

function Header({ nav, language, setLanguage, langButton }) {
  return (
    <header>
      <div className="container navbar">
        <div className="logo-area">
          <img src={logo} alt="REVIRA Logo" className="rotating-logo" />
          <span className="logo-text">REVIRA</span>
        </div>

        <div className="nav-right">
          <nav className="nav-links">
            <a href="#home">{nav.home}</a>
            <a href="#about">{nav.about}</a>
            <a href="#treatments">{nav.treatments}</a>
            <a href="#booking">{nav.booking}</a>
            <a href="#contact">{nav.contact}</a>
          </nav>

          <button
            className="lang-toggle"
            onClick={() => setLanguage(language === "he" ? "ar" : "he")}
          >
            {langButton}
          </button>
        </div>
      </div>
    </header>
  );
}

export default Header;