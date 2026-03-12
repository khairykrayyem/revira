import { useState } from "react";
import { adminLoginRequest } from "../services/adminApi";

function AdminLogin({ onLogin, language }) {
  const [username, setUsername] = useState("reviraadmin");
  const [password, setPassword] = useState("12345678");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const labels =
    language === "he"
      ? {
          title: "כניסת אדמין",
          subtitle: "התחברו כדי לנהל תורים, ימים ושעות.",
          username: "שם משתמש",
          password: "סיסמה",
          button: "התחבר",
          loading: "מתחבר...",
        }
      : {
          title: "دخول الأدمن",
          subtitle: "سجّل الدخول لإدارة المواعيد والأيام والساعات.",
          username: "اسم المستخدم",
          password: "كلمة المرور",
          button: "تسجيل الدخول",
          loading: "جارٍ تسجيل الدخول...",
        };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      setLoading(true);
      const result = await adminLoginRequest(username, password);
      localStorage.setItem("revira_admin_token", result.token);
      onLogin(result.token);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="section admin-page">
      <div className="container">
        <div className="card admin-login-card">
          <h2 className="section-title">{labels.title}</h2>
          <p className="section-subtitle">{labels.subtitle}</p>

          <form className="admin-login-form" onSubmit={handleSubmit}>
            <div className="form-group">
              <label>{labels.username}</label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label>{labels.password}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && <div className="booking-message error-message">{error}</div>}

            <button className="btn btn-primary admin-login-btn" type="submit" disabled={loading}>
              {loading ? labels.loading : labels.button}
            </button>
          </form>
        </div>
      </div>
    </section>
  );
}

export default AdminLogin;