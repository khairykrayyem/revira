export const jsonErrorHandler = (error, _req, res, next) => {
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ message: "Request body is too large" });
  }

  if (error instanceof SyntaxError && error?.type === "entity.parse.failed") {
    return res.status(400).json({ message: "Malformed JSON" });
  }

  next(error);
};
