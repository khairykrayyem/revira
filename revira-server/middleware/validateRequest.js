export const validateRequest = (schemas) => (req, res, next) => {
  for (const source of ["params", "query", "body"]) {
    const schema = schemas[source];
    if (!schema) continue;

    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({ message: "Invalid request" });
    }

    req[source] = result.data;
  }

  next();
};

