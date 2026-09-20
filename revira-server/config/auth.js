export const MIN_JWT_SECRET_BYTES = 32;

export const validateAuthConfig = (env = process.env) => {
  const secret = env.JWT_SECRET;

  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("Authentication configuration is invalid: JWT_SECRET is required");
  }

  if (Buffer.byteLength(secret.trim(), "utf8") < MIN_JWT_SECRET_BYTES) {
    throw new Error(
      `Authentication configuration is invalid: JWT_SECRET must contain at least ${MIN_JWT_SECRET_BYTES} bytes`
    );
  }

  return { jwtSecret: secret };
};
