import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const SALT_ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

export function checkPassword(hash, password) {
  return bcrypt.compare(password, hash);
}

export function signJWT(userId, secret) {
  return jwt.sign(
    { user_id: userId },
    secret,
    { expiresIn: "24h" }
  );
}

export function verifyJWT(token, secret) {
  try {
    const decoded = jwt.verify(token, secret);
    return decoded.user_id;
  } catch {
    return null;
  }
}
